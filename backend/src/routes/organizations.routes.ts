import { Router, Response } from 'express';
import { db } from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ============================================================
// GET /settings - Get org settings
// ============================================================
router.get('/settings',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const org = await db.organization.findUnique({
        where: { id: req.orgId! },
      });

      if (!org) {
        res.status(404).json({
          success: false,
          error: { message: 'Organization not found.', statusCode: 404 },
        });
        return;
      }

      const userCount = await db.user.count({ where: { orgId: org.id } });

      res.json({
        success: true,
        data: {
          id: org.id,
          name: org.name,
          planTier: org.planTier,
          userCount,
          createdAt: org.createdAt,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch org settings.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// PUT /settings - Update org settings (name only for now)
// ============================================================
router.put('/settings',
  authenticate,
  requirePermission('org.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name } = req.body;
      const orgId = req.orgId!;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: { message: 'Organization name is required.', statusCode: 400 },
        });
        return;
      }

      const updated = await db.organization.update({
        where: { id: orgId },
        data: { name: name.trim() },
      });

      res.json({
        success: true,
        data: {
          id: updated.id,
          name: updated.name,
          planTier: updated.planTier,
          createdAt: updated.createdAt,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to update org settings.', statusCode: 500 },
      });
    }
  },
);

export default router;
