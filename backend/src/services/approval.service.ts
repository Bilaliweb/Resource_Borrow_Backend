import { db } from '../prisma';
import { createAuditLog } from './audit.service';

// ============================================================
// Permission key mapping: roleRequired -> permission key
// ============================================================
const ROLE_TO_PERMISSION: Record<string, string> = {
  manager: 'borrow_request.approve.current_manager',
  department_head: 'borrow_request.approve.dept_head',
  hr_manager: 'borrow_request.approve.hr',
  owner: 'borrow_request.approve.final',
};

// ============================================================
// Get pending approval steps for the current user
// ============================================================
export async function getMyApprovals(orgId: string, userId: string, params: {
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  // Find the user's roles to determine which approval steps they can act on
  const userRoles = await db.userRole.findMany({
    where: { userId, role: { orgId } },
    include: { role: true },
  });
  const roleNames = userRoles.map((ur) => ur.role.name);

  // Build where clause: steps that match the user's roles and are pending
  const where: any = {
    borrowRequest: { orgId },
    roleRequired: { in: roleNames },
  };

  if (params.status) {
    where.status = params.status;
  } else {
    // Default to pending only
    where.status = 'pending';
  }

  // Additionally, for pending steps, the user must have the matching permission
  // We'll filter in-memory for permissions since it's role-based

  const [steps, total] = await Promise.all([
    db.requestApprovalStep.findMany({
      where,
      include: {
        borrowRequest: {
          include: {
            employee: true,
            fromManager: true,
            toManager: true,
            project: true,
          },
        },
        approver: true,
      },
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.requestApprovalStep.count({ where }),
  ]);

  // Filter by permission: only include steps where user has the matching approve permission
  const userPermissions = await db.userRole.findMany({
    where: { userId, role: { orgId } },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });
  const permKeys = new Set(
    userPermissions.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))
  );

  const filteredSteps = steps.filter((step) => {
    const requiredPerm = ROLE_TO_PERMISSION[step.roleRequired];
    if (!requiredPerm) return false;
    return permKeys.has(requiredPerm);
  });

  return {
    data: filteredSteps,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ============================================================
// Process approval action (approve or reject)
// ============================================================
export async function processApprovalAction(
  stepId: string,
  orgId: string,
  userId: string,
  decision: 'approved' | 'rejected',
  comment?: string,
) {
  // 1. Find the approval step with its borrow request
  const step = await db.requestApprovalStep.findFirst({
    where: { id: stepId },
    include: {
      borrowRequest: {
        include: {
          approvalSteps: {
            orderBy: { stepOrder: 'asc' },
          },
          },
        },
      },
  });

  if (!step) {
    throw { statusCode: 404, message: 'Approval step not found.' };
  }

  if (step.borrowRequest.orgId !== orgId) {
    throw { statusCode: 403, message: 'This approval step does not belong to your organization.' };
  }

  if (step.status !== 'pending') {
    throw { statusCode: 400, message: `This step is already ${step.status}. Cannot act on it.` };
  }

  if (step.borrowRequest.status !== 'pending' && step.borrowRequest.status !== 'approved') {
    throw { statusCode: 400, message: `Cannot approve/reject a request that is ${step.borrowRequest.status}.` };
  }

  // 2. Verify the user has the required permission for this step's role
  const requiredPerm = ROLE_TO_PERMISSION[step.roleRequired];
  if (!requiredPerm) {
    throw { statusCode: 500, message: `Unknown role type: ${step.roleRequired}. No permission mapping found.` };
  }

  const userPermissions = await db.userRole.findMany({
    where: { userId, role: { orgId } },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });
  const permKeys = userPermissions.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key));

  if (!permKeys.includes(requiredPerm)) {
    throw { statusCode: 403, message: `You do not have permission to approve as ${step.roleRequired.replace(/_/g, ' ')}.` };
  }

  // 3. Update the approval step
  const updatedStep = await db.requestApprovalStep.update({
    where: { id: stepId },
    data: {
      status: decision,
      approverUserId: userId,
      comment: comment || null,
      resolvedAt: new Date(),
    },
  });

  // 4. Handle workflow advancement
  const borrowRequest = step.borrowRequest;
  const allSteps = borrowRequest.approvalSteps;

  if (decision === 'rejected') {
    // Reject the entire request and skip remaining steps
    await db.borrowRequest.update({
      where: { id: borrowRequest.id },
      data: { status: 'rejected' },
    });

    // Skip all remaining pending steps
    const pendingSteps = allSteps.filter(
      (s) => s.status === 'pending' && s.id !== stepId
    );
    if (pendingSteps.length > 0) {
      await db.requestApprovalStep.updateMany({
        where: { id: { in: pendingSteps.map((s) => s.id) } },
        data: { status: 'skipped' },
      });
    }

    // Audit: request rejected
    await createAuditLog({
      orgId,
      actorUserId: userId,
      action: 'borrow_request.rejected',
      entityType: 'borrow_request',
      entityId: borrowRequest.id,
      metadata: {
        requestCode: borrowRequest.requestCode,
        stepOrder: step.stepOrder,
        roleRequired: step.roleRequired,
        comment: comment || null,
        skippedSteps: pendingSteps.length,
      },
    });

    // Audit: approval steps skipped
    for (const s of pendingSteps) {
      await createAuditLog({
        orgId,
        actorUserId: userId,
        action: 'approval_step.skipped',
        entityType: 'approval_step',
        entityId: s.id,
        metadata: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
          stepOrder: s.stepOrder,
          roleRequired: s.roleRequired,
          reason: 'rejection_cascade',
        },
      });
    }

    // Create notification for the requester (toManager)
    await createNotification({
      orgId,
      userId: borrowRequest.toManagerId,
      type: 'request_rejected',
      payload: {
        borrowRequestId: borrowRequest.id,
        requestCode: borrowRequest.requestCode,
        stepOrder: step.stepOrder,
        rejectedBy: userId,
        comment: comment || null,
      },
    });

    // Also notify the employee
    await createNotification({
      orgId,
      userId: borrowRequest.employeeId,
      type: 'request_rejected',
      payload: {
        borrowRequestId: borrowRequest.id,
        requestCode: borrowRequest.requestCode,
      },
    });

  } else {
    // Decision is 'approved'
    // Check if all steps are now approved
    const remainingPending = allSteps.filter(
      (s) => s.status === 'pending' && s.id !== stepId
    );

    if (remainingPending.length === 0) {
      // All steps approved — mark request as 'approved'
      await db.borrowRequest.update({
        where: { id: borrowRequest.id },
        data: { status: 'approved' },
      });

      // Audit: request fully approved
      await createAuditLog({
        orgId,
        actorUserId: userId,
        action: 'borrow_request.approved',
        entityType: 'borrow_request',
        entityId: borrowRequest.id,
        metadata: {
          requestCode: borrowRequest.requestCode,
          finalStepOrder: step.stepOrder,
          totalSteps: allSteps.length,
        },
      });

      // Notify the requester
      await createNotification({
        orgId,
        userId: borrowRequest.toManagerId,
        type: 'request_approved',
        payload: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
        },
      });

      // Notify the from-manager
      await createNotification({
        orgId,
        userId: borrowRequest.fromManagerId,
        type: 'request_approved',
        payload: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
        },
      });

      // Notify the employee
      await createNotification({
        orgId,
        userId: borrowRequest.employeeId,
        type: 'request_approved',
        payload: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
        },
      });
    } else {
      // Audit: individual step approved
      await createAuditLog({
        orgId,
        actorUserId: userId,
        action: 'approval_step.approved',
        entityType: 'approval_step',
        entityId: stepId,
        metadata: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
          stepOrder: step.stepOrder,
          roleRequired: step.roleRequired,
          comment: comment || null,
        },
      });

      // More steps remain — notify the next pending step's potential approvers
      const nextStep = remainingPending.sort((a, b) => a.stepOrder - b.stepOrder)[0];

      // Find users with the required role for the next step
      const nextRoleName = nextStep.roleRequired;
      const usersWithRole = await db.userRole.findMany({
        where: { role: { orgId, name: nextRoleName } },
        include: { user: { select: { id: true } } },
      });

      for (const ur of usersWithRole) {
        await createNotification({
          orgId,
          userId: ur.user.id,
          type: 'approval_needed',
          payload: {
            borrowRequestId: borrowRequest.id,
            requestCode: borrowRequest.requestCode,
            stepOrder: nextStep.stepOrder,
            roleRequired: nextRoleName,
          },
        });
      }

      // Notify progress to the requester
      await createNotification({
        orgId,
        userId: borrowRequest.toManagerId,
        type: 'approval_progress',
        payload: {
          borrowRequestId: borrowRequest.id,
          requestCode: borrowRequest.requestCode,
          stepOrder: step.stepOrder,
          totalSteps: allSteps.length,
          approvedBy: userId,
        },
      });
    }
  }

  // 5. Return the updated borrow request with all relations
  const result = await db.borrowRequest.findFirst({
    where: { id: borrowRequest.id, orgId },
    include: {
      employee: true,
      fromManager: true,
      toManager: true,
      project: true,
      approvalSteps: {
        orderBy: { stepOrder: 'asc' },
        include: { approver: true },
      },
    },
  });

  return result!;
}

// ============================================================
// Helper: Create a notification record
// ============================================================
async function createNotification(data: {
  orgId: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
}) {
  await db.notification.create({
    data: {
      orgId: data.orgId,
      userId: data.userId,
      type: data.type,
      payload: JSON.stringify(data.payload),
    },
  });
}

// ============================================================
// Get my requests (where user is the toManager / requester)
// ============================================================
export async function getMyRequests(orgId: string, userId: string, params: {
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  const where: any = {
    orgId,
    toManagerId: userId,
  };

  if (params.status) {
    where.status = params.status;
  }

  const [data, total] = await Promise.all([
    db.borrowRequest.findMany({
      where,
      include: {
        employee: true,
        fromManager: true,
        toManager: true,
        project: true,
        approvalSteps: {
          orderBy: { stepOrder: 'asc' },
          include: { approver: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.borrowRequest.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ============================================================
// Get notification count (unread)
// ============================================================
export async function getUnreadNotificationCount(orgId: string, userId: string) {
  const count = await db.notification.count({
    where: { orgId, userId, isRead: false },
  });
  return { count };
}

// ============================================================
// Get notifications for user
// ============================================================
export async function getNotifications(orgId: string, userId: string, params: {
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  const [data, total] = await Promise.all([
    db.notification.findMany({
      where: { orgId, userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({
      where: { orgId, userId },
    }),
  ]);

  return {
    data: data.map((n) => ({
      ...n,
      payload: JSON.parse(n.payload),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ============================================================
// Mark notification as read
// ============================================================
export async function markNotificationRead(notificationId: string, orgId: string, userId: string) {
  const notification = await db.notification.findFirst({
    where: { id: notificationId, orgId, userId },
  });

  if (!notification) {
    throw { statusCode: 404, message: 'Notification not found.' };
  }

  await db.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });

  return { success: true };
}

// ============================================================
// Mark all notifications as read
// ============================================================
export async function markAllNotificationsRead(orgId: string, userId: string) {
  await db.notification.updateMany({
    where: { orgId, userId, isRead: false },
    data: { isRead: true },
  });
  return { success: true };
}
