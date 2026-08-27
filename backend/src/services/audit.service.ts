import { db } from '../prisma';

// ============================================================
// Audit Log Service — Record and query state transitions
// ============================================================

export interface CreateAuditLog {
  orgId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a single audit log entry.
 */
export async function createAuditLog(data: CreateAuditLog) {
  await db.auditLog.create({
    data: {
      orgId: data.orgId,
      actorUserId: data.actorUserId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      metadata: data.metadata ? JSON.stringify(data.metadata) : JSON.stringify({}),
    },
  });
}

/**
 * Create multiple audit log entries in a single transaction.
 */
export async function createAuditLogs(entries: CreateAuditLog[]) {
  if (entries.length === 0) return;
   await db.auditLog.createMany({
    data: entries.map((e) => ({
      orgId: e.orgId,
      actorUserId: e.actorUserId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata ? JSON.stringify(e.metadata) : JSON.stringify({}),
    })),
  });
}

/**
 * Get audit logs for a specific entity (e.g. a BorrowRequest).
 */
export async function getAuditLogs(
  orgId: string,
  params: {
    entityType?: string;
    entityId?: string;
    actorUserId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));

  const where: any = { orgId };

  if (params.entityType) where.entityType = params.entityType;
  if (params.entityId) where.entityId = params.entityId;
  if (params.actorUserId) where.actorUserId = params.actorUserId;
  if (params.action) where.action = params.action;

  const [data, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    data: data.map((log) => ({
      ...log,
      metadata: JSON.parse(log.metadata),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
