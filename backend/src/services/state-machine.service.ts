import { db } from '../prisma';
import { createAuditLog } from './audit.service';

// ============================================================
// State Machine Cron Service
// Auto-activates approved requests when startDatetime arrives
// Auto-completes active requests when endDatetime passes
// ============================================================

const SYSTEM_USER_ID = 'system'; // Virtual actor for cron-triggered transitions

/**
 * Run one tick of the state machine cron.
 * Call this on an interval (e.g. every 60 seconds).
 * Returns counts of activated and completed requests.
 */
export async function runStateMachineTick(): Promise<{
  activated: number;
  completed: number;
}> {
  const now = new Date();
  let activated = 0;
  let completed = 0;

  // ---- 1. Auto-activate: approved requests whose startDatetime <= now ----
  const toActivate = await db.borrowRequest.findMany({
    where: {
      status: 'approved',
      startDatetime: { lte: now },
    },
  });

  for (const br of toActivate) {
    await db.borrowRequest.update({
      where: { id: br.id },
      data: { status: 'active' },
    });

    // Audit
    await createAuditLog({
      orgId: br.orgId,
      actorUserId: SYSTEM_USER_ID,
      action: 'borrow_request.activated',
      entityType: 'borrow_request',
      entityId: br.id,
      metadata: {
        requestCode: br.requestCode,
        previousStatus: 'approved',
        triggeredBy: 'cron',
      },
    });

    // Notify relevant parties
    const targets = [br.toManagerId, br.fromManagerId, br.employeeId];
    for (const t of new Set(targets)) {
      await db.notification.create({
        data: {
          orgId: br.orgId,
          userId: t,
          type: 'request_active',
          payload: JSON.stringify({
            borrowRequestId: br.id,
            requestCode: br.requestCode,
            activatedBy: 'system',
          }),
        },
      });
    }

    activated++;
  }

  // ---- 2. Auto-complete: active requests whose endDatetime < now ----
  const toComplete = await db.borrowRequest.findMany({
    where: {
      status: 'active',
      endDatetime: { lt: now },
    },
  });

  for (const br of toComplete) {
    await db.borrowRequest.update({
      where: { id: br.id },
      data: { status: 'completed' },
    });

    // Audit
    await createAuditLog({
      orgId: br.orgId,
      actorUserId: SYSTEM_USER_ID,
      action: 'borrow_request.completed',
      entityType: 'borrow_request',
      entityId: br.id,
      metadata: {
        requestCode: br.requestCode,
        previousStatus: 'active',
        triggeredBy: 'cron',
      },
    });

    // Notify relevant parties
    const targets = [br.toManagerId, br.fromManagerId, br.employeeId];
    for (const t of new Set(targets)) {
      await db.notification.create({
        data: {
          orgId: br.orgId,
          userId: t,
          type: 'request_completed',
          payload: JSON.stringify({
            borrowRequestId: br.id,
            requestCode: br.requestCode,
            completedBy: 'system',
          }),
        },
      });
    }

    completed++;
  }

  if (activated > 0 || completed > 0) {
    console.log(
      `[StateMachine] tick: ${activated} activated, ${completed} completed at ${now.toISOString()}`,
    );
  }

  return { activated, completed };
}

/**
 * Start the cron interval. Returns a cleanup function to stop it.
 */
export function startStateMachineCron(intervalMs = 60_000): () => void {
  // Run immediately on start
  runStateMachineTick().catch((err) =>
    console.error('[StateMachine] initial tick error:', err),
  );

  const timer = setInterval(() => {
    runStateMachineTick().catch((err) =>
      console.error('[StateMachine] tick error:', err),
    );
  }, intervalMs);

  return () => clearInterval(timer);
}
