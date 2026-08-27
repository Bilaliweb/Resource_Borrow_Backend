import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import * as auditService from '../services/audit.service';
import { db } from '../prisma';

const router = Router();

// ============================================================
// GET / - List audit logs (paginated, filtered)
// ============================================================
router.get('/',
  authenticate,
  requirePermission('audit.view'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const entityType = req.query.entityType as string || undefined;
      const entityId = req.query.entityId as string || undefined;
      const actorUserId = req.query.actorUserId as string || undefined;
      const action = req.query.action as string || undefined;

      const result = await auditService.getAuditLogs(orgId, {
        page,
        pageSize,
        entityType,
        entityId,
        actorUserId,
        action,
      });

      // Enrich with actor user info
      const enrichedData = await Promise.all(
        result.data.map(async (log: any) => {
          let actor = null;
          if (log.actorUserId && log.actorUserId !== 'system') {
            const user = await db.user.findUnique({
              where: { id: log.actorUserId },
              select: { id: true, fullName: true, jobTitle: true },
            });
            actor = user;
          } else if (log.actorUserId === 'system') {
            actor = { id: 'system', fullName: 'System', jobTitle: 'Automated' };
          }
          return { ...log, actor };
        }),
      );

      res.json({
        success: true,
        data: { ...result, data: enrichedData },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch audit logs.', statusCode: 500 },
      });
    }
  },
);

export default router;
