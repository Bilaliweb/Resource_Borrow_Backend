import { db } from '../prisma';
import { createAuditLog } from './audit.service';

// ============================================================
// Generate sequential request code: BR-{YYYY}-{NNN}
// ============================================================
export async function generateRequestCode(orgId: string): Promise<string> {
  const year = new Date().getFullYear().toString();
  const prefix = `BR-${year}-`;

  // Find all request codes for this org that start with the current year prefix
  const requests = await db.borrowRequest.findMany({
    where: {
      orgId,
      requestCode: { startsWith: prefix },
    },
    select: { requestCode: true },
    orderBy: { requestCode: 'desc' },
    take: 1,
  });

  let nextNum = 1;
  if (requests.length > 0) {
    const lastCode = requests[0].requestCode;
    const numStr = lastCode.replace(prefix, '');
    const num = parseInt(numStr, 10);
    if (!isNaN(num)) {
      nextNum = num + 1;
    }
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`;
}

// ============================================================
// Create borrow request with approval steps
// ============================================================
export async function createBorrowRequest(
  data: {
    employeeId: string;
    fromManagerId: string;
    projectId: string;
    startDatetime: string;
    endDatetime: string;
    reason: string;
  },
  orgId: string,
  requesterId: string,
) {
  const { employeeId, fromManagerId, projectId, startDatetime, endDatetime, reason } = data;

  // Validate employee exists and belongs to org
  const employee = await db.user.findFirst({
    where: { id: employeeId, orgId },
  });
  if (!employee) {
    throw { statusCode: 404, message: 'Employee not found in your organization.' };
  }

  // Validate fromManager exists and belongs to org
  const fromManager = await db.user.findFirst({
    where: { id: fromManagerId, orgId },
  });
  if (!fromManager) {
    throw { statusCode: 404, message: 'From manager not found in your organization.' };
  }

  // Validate project exists and belongs to org
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
  });
  if (!project) {
    throw { statusCode: 404, message: 'Project not found in your organization.' };
  }

  // Generate request code
  const requestCode = await generateRequestCode(orgId);

  // Find org's default approval workflow template
  const template = await db.approvalWorkflowTemplate.findFirst({
    where: { orgId, isDefault: true },
    include: { steps: { orderBy: { stepOrder: 'asc' }, include: { roleRequired: true } } },
  });

  if (!template) {
    throw { statusCode: 500, message: 'No default approval workflow template configured for this organization.' };
  }

  // Create borrow request with approval steps
  const borrowRequest = await db.borrowRequest.create({
    data: {
      orgId,
      requestCode,
      employeeId,
      fromManagerId,
      toManagerId: requesterId,
      projectId,
      startDatetime: new Date(startDatetime),
      endDatetime: new Date(endDatetime),
      reason,
      status: 'pending',
      approvalSteps: {
        create: template.steps.map((step) => ({
          stepOrder: step.stepOrder,
          roleRequired: step.roleRequired.name,
          status: 'pending',
        })),
      },
    },
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

  // Audit: request created
  await createAuditLog({
    orgId,
    actorUserId: requesterId,
    action: 'borrow_request.created',
    entityType: 'borrow_request',
    entityId: borrowRequest.id,
    metadata: {
      requestCode,
      employeeId,
      fromManagerId,
      projectId,
      startDatetime: data.startDatetime,
      endDatetime: data.endDatetime,
    },
  });

  // Notification: request_submitted to requester
  await db.notification.create({
    data: {
      orgId,
      userId: requesterId,
      type: 'request_submitted',
      payload: JSON.stringify({
        borrowRequestId: borrowRequest.id,
        requestCode,
      }),
    },
  });

  // Notification: request_submitted to from-manager
  if (fromManagerId !== requesterId) {
    await db.notification.create({
      data: {
        orgId,
        userId: fromManagerId,
        type: 'request_submitted',
        payload: JSON.stringify({
          borrowRequestId: borrowRequest.id,
          requestCode,
        }),
      },
    });
  }

  // Notification: approval_needed for the first step's role holders
  const firstStep = template.steps[0];
  if (firstStep) {
    const firstRoleName = firstStep.roleRequired.name;
    const usersWithRole = await db.userRole.findMany({
      where: { role: { orgId, name: firstRoleName } },
      include: { user: { select: { id: true } } },
    });
    for (const ur of usersWithRole) {
      await db.notification.create({
        data: {
          orgId,
          userId: ur.user.id,
          type: 'approval_needed',
          payload: JSON.stringify({
            borrowRequestId: borrowRequest.id,
            requestCode,
            stepOrder: firstStep.stepOrder,
            roleRequired: firstRoleName,
          }),
        },
      });
    }
  }

  return borrowRequest;
}

// ============================================================
// List borrow requests with pagination and filters
// ============================================================
export async function getBorrowRequests(
  orgId: string,
  params: {
    page?: number;
    pageSize?: number;
    status?: string;
    search?: string;
  },
) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  // Build where clause
  const where: any = { orgId };

  if (params.status) {
    where.status = params.status;
  }

  if (params.search) {
    where.OR = [
      { requestCode: { contains: params.search } },
      { employee: { fullName: { contains: params.search } } },
    ];
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
// Get single borrow request by ID with full relations
// ============================================================
export async function getBorrowRequestById(id: string, orgId: string) {
  const borrowRequest = await db.borrowRequest.findFirst({
    where: { id, orgId },
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

  if (!borrowRequest) {
    throw { statusCode: 404, message: 'Borrow request not found.' };
  }

  return borrowRequest;
}

// ============================================================
// Cancel borrow request
// ============================================================
export async function cancelBorrowRequest(id: string, orgId: string, userId: string) {
  // Find the request
  const borrowRequest = await db.borrowRequest.findFirst({
    where: { id, orgId },
    include: {
      approvalSteps: {
        orderBy: { stepOrder: 'asc' },
      },
    },
  });

  if (!borrowRequest) {
    throw { statusCode: 404, message: 'Borrow request not found.' };
  }

  // Only cancel if status is pending or approved
  if (borrowRequest.status !== 'pending' && borrowRequest.status !== 'approved') {
    throw { statusCode: 400, message: 'Only pending or approved borrow requests can be cancelled.' };
  }

  // Update request status
  const updated = await db.borrowRequest.update({
    where: { id },
    data: { status: 'cancelled' },
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

  // Set remaining pending approval steps to 'skipped'
  const pendingSteps = updated.approvalSteps.filter((s) => s.status === 'pending');
  if (pendingSteps.length > 0) {
    await db.requestApprovalStep.updateMany({
      where: { id: { in: pendingSteps.map((s) => s.id) } },
      data: { status: 'skipped' },
    });
  }

  // Audit: request cancelled
  await createAuditLog({
    orgId,
    actorUserId: userId,
    action: 'borrow_request.cancelled',
    entityType: 'borrow_request',
    entityId: id,
    metadata: {
      requestCode: borrowRequest.requestCode,
      previousStatus: borrowRequest.status,
      skippedSteps: pendingSteps.length,
    },
  });

  // Notify relevant parties about cancellation
  const cancelNotifyTargets = [
    borrowRequest.toManagerId,
    borrowRequest.fromManagerId,
    borrowRequest.employeeId,
  ];
  for (const targetId of new Set(cancelNotifyTargets)) {
    await db.notification.create({
      data: {
        orgId,
        userId: targetId,
        type: 'request_cancelled',
        payload: JSON.stringify({
          borrowRequestId: id,
          requestCode: borrowRequest.requestCode,
          cancelledBy: userId,
        }),
      },
    });
  }

  // Re-fetch with updated steps
  const result = await db.borrowRequest.findFirst({
    where: { id },
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
// State Machine: Valid transitions
// ============================================================
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['cancelled', 'rejected', 'approved'],
  approved: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  rejected: [],
  cancelled: [],
};

function canTransition(currentStatus: string, newStatus: string): boolean {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

// ============================================================
// Activate borrow request (approved → active)
// ============================================================
export async function activateBorrowRequest(id: string, orgId: string, userId: string) {
  const borrowRequest = await db.borrowRequest.findFirst({
    where: { id, orgId },
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

  if (!borrowRequest) {
    throw { statusCode: 404, message: 'Borrow request not found.' };
  }

  if (!canTransition(borrowRequest.status, 'active')) {
    throw {
      statusCode: 400,
      message: `Cannot activate a request that is "${borrowRequest.status}". Only approved requests can be activated.`,
    };
  }

  // Update status
  const updated = await db.borrowRequest.update({
    where: { id },
    data: { status: 'active' },
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

  // Audit: request activated
  await createAuditLog({
    orgId,
    actorUserId: userId,
    action: 'borrow_request.activated',
    entityType: 'borrow_request',
    entityId: id,
    metadata: {
      requestCode: borrowRequest.requestCode,
      previousStatus: borrowRequest.status,
      triggeredBy: 'manual',
    },
  });

  // Notify relevant parties
  const notifyTargets = [
    borrowRequest.toManagerId,     // requester
    borrowRequest.fromManagerId,   // from-manager
    borrowRequest.employeeId,      // employee
  ];
  for (const targetId of new Set(notifyTargets)) {
    await db.notification.create({
      data: {
        orgId,
        userId: targetId,
        type: 'request_active',
        payload: JSON.stringify({
          borrowRequestId: id,
          requestCode: borrowRequest.requestCode,
          activatedBy: userId,
        }),
      },
    });
  }

  return updated;
}

// ============================================================
// Complete borrow request (active → completed)
// ============================================================
export async function completeBorrowRequest(id: string, orgId: string, userId: string) {
  const borrowRequest = await db.borrowRequest.findFirst({
    where: { id, orgId },
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

  if (!borrowRequest) {
    throw { statusCode: 404, message: 'Borrow request not found.' };
  }

  if (!canTransition(borrowRequest.status, 'completed')) {
    throw {
      statusCode: 400,
      message: `Cannot complete a request that is "${borrowRequest.status}". Only active requests can be completed.`,
    };
  }

  // Update status
  const updated = await db.borrowRequest.update({
    where: { id },
    data: { status: 'completed' },
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

  // Audit: request completed
  await createAuditLog({
    orgId,
    actorUserId: userId,
    action: 'borrow_request.completed',
    entityType: 'borrow_request',
    entityId: id,
    metadata: {
      requestCode: borrowRequest.requestCode,
      previousStatus: borrowRequest.status,
      triggeredBy: 'manual',
    },
  });

  // Notify relevant parties
  const notifyTargets = [
    borrowRequest.toManagerId,
    borrowRequest.fromManagerId,
    borrowRequest.employeeId,
  ];
  for (const targetId of new Set(notifyTargets)) {
    await db.notification.create({
      data: {
        orgId,
        userId: targetId,
        type: 'request_completed',
        payload: JSON.stringify({
          borrowRequestId: id,
          requestCode: borrowRequest.requestCode,
          completedBy: userId,
        }),
      },
    });
  }

  return updated;
}
