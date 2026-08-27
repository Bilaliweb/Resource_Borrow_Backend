import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import * as approvalService from '../services/approval.service';

const router = Router();

// ============================================================
// GET / - List notifications for current user
// ============================================================
router.get('/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const userId = req.userId!;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;

      const result = await approvalService.getNotifications(orgId, userId, { page, pageSize });

      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch notifications.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// GET /unread-count - Get unread notification count
// ============================================================
router.get('/unread-count',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const userId = req.userId!;

      const result = await approvalService.getUnreadNotificationCount(orgId, userId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch notification count.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST /:id/read - Mark a notification as read
// ============================================================
router.post('/:id/read',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const orgId = req.orgId!;
      const userId = req.userId!;

      await approvalService.markNotificationRead(id, orgId, userId);
      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to mark notification as read.', statusCode },
      });
    }
  },
);

// ============================================================
// POST /read-all - Mark all notifications as read
// ============================================================
router.post('/read-all',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const userId = req.userId!;

      await approvalService.markAllNotificationsRead(orgId, userId);
      res.json({ success: true, data: { success: true } });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to mark all notifications as read.', statusCode: 500 },
      });
    }
  },
);

export default router;
