import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { db } from '../prisma';
import * as approvalService from '../services/approval.service';

const router = Router();

// ============================================================
// Helper: strip passwordHash from user objects
// ============================================================
function serializeUser(user: any) {
  if (!user) return user;
  const { passwordHash, ...safe } = user;
  return safe;
}

function serializeRequest(br: any) {
  return {
    ...br,
    employee: serializeUser(br.employee),
    fromManager: serializeUser(br.fromManager),
    toManager: serializeUser(br.toManager),
    approvalSteps: br.approvalSteps?.map((step: any) => ({
      ...step,
      approver: serializeUser(step.approver),
    })),
  };
}

// ============================================================
// GET /templates - List org's approval workflow templates
// ============================================================
router.get('/templates',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;

      const templates = await db.approvalWorkflowTemplate.findMany({
        where: { orgId },
        include: {
          steps: {
            orderBy: { stepOrder: 'asc' },
            include: { roleRequired: true },
          },
        },
        orderBy: { id: 'asc' },
      });

      res.json({ success: true, data: templates });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to list approval templates.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// GET /my-pending - Get pending approval steps for current user
// ============================================================
router.get('/my-pending',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const userId = req.userId!;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;

      const result = await approvalService.getMyApprovals(orgId, userId, { page, pageSize });

      res.json({
        success: true,
        data: {
          ...result,
          data: result.data.map((step: any) => ({
            ...step,
            borrowRequest: serializeRequest(step.borrowRequest),
          })),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch pending approvals.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST /:stepId/action - Approve or reject an approval step
// ============================================================
router.post('/:stepId/action',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const stepId = req.params.stepId as string;
      const { decision, comment } = req.body;
      const orgId = req.orgId!;
      const userId = req.userId!;

      if (!decision || !['approved', 'rejected'].includes(decision)) {
        res.status(400).json({
          success: false,
          error: { message: 'decision must be "approved" or "rejected".', statusCode: 400 },
        });
        return;
      }

      const result = await approvalService.processApprovalAction(
        stepId, orgId, userId, decision, comment,
      );

      res.json({
        success: true,
        data: serializeRequest(result),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to process approval action.', statusCode },
      });
    }
  },
);

// ============================================================
// GET /my-requests - Get requests where user is the requester (toManager)
// ============================================================
router.get('/my-requests',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const userId = req.userId!;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const status = req.query.status as string || undefined;

      const result = await approvalService.getMyRequests(orgId, userId, { page, pageSize, status });

      res.json({
        success: true,
        data: {
          ...result,
          data: result.data.map(serializeRequest),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch my requests.', statusCode: 500 },
      });
    }
  },
);

export default router;
