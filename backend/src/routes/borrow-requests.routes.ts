import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { db } from '../prisma';
import * as borrowRequestService from '../services/borrow-request.service';

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
// GET / - List borrow requests (paginated, filtered)
// ============================================================
router.get('/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const status = req.query.status as string || undefined;
      const search = (req.query.search as string || '').trim() || undefined;

      const result = await borrowRequestService.getBorrowRequests(orgId, {
        page,
        pageSize,
        status,
        search,
      });

      res.json({
        success: true,
        data: {
          ...result,
          data: result.data.map(serializeRequest),
        },
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to list borrow requests.', statusCode },
      });
    }
  },
);

// ============================================================
// GET /request-code - Generate next request code
// ============================================================
router.get('/request-code',
  authenticate,
  requirePermission('borrow_request.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const requestCode = await borrowRequestService.generateRequestCode(orgId);
      res.json({
        success: true,
        data: { requestCode },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to generate request code.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST / - Create borrow request
// ============================================================
router.post('/',
  authenticate,
  requirePermission('borrow_request.create'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { employeeId, fromManagerId, projectId, startDatetime, endDatetime, reason } = req.body;
      const orgId = req.orgId!;
      const requesterId = req.userId!;

      // Validate required fields
      if (!employeeId || !fromManagerId || !projectId || !startDatetime || !endDatetime || !reason) {
        res.status(400).json({
          success: false,
          error: {
            message: 'employeeId, fromManagerId, projectId, startDatetime, endDatetime, and reason are required.',
            statusCode: 400,
          },
        });
        return;
      }

      // Validate dates
      const start = new Date(startDatetime);
      const end = new Date(endDatetime);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({
          success: false,
          error: { message: 'startDatetime and endDatetime must be valid ISO date strings.', statusCode: 400 },
        });
        return;
      }

      if (end <= start) {
        res.status(400).json({
          success: false,
          error: { message: 'endDatetime must be after startDatetime.', statusCode: 400 },
        });
        return;
      }

      const borrowRequest = await borrowRequestService.createBorrowRequest(
        { employeeId, fromManagerId, projectId, startDatetime, endDatetime, reason },
        orgId,
        requesterId,
      );

      res.status(201).json({
        success: true,
        data: serializeRequest(borrowRequest),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to create borrow request.', statusCode },
      });
    }
  },
);

// ============================================================
// GET /:id - Get single borrow request with full details
// ============================================================
router.get('/:id',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const orgId = req.orgId!;

      const borrowRequest = await borrowRequestService.getBorrowRequestById(id, orgId);
      res.json({
        success: true,
        data: serializeRequest(borrowRequest),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to fetch borrow request.', statusCode },
      });
    }
  },
);

// ============================================================
// POST /:id/cancel - Cancel borrow request
// ============================================================
router.post('/:id/cancel',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const orgId = req.orgId!;
      const userId = req.userId!;

      // Authorization: requester (toManager) or user.manage permission
      const request = await borrowRequestService.getBorrowRequestById(id, orgId);
      const isRequester = request.toManagerId === userId;

      if (!isRequester) {
        // Check user.manage permission
        const userRoles = await db.userRole.findMany({
          where: { userId, role: { orgId } },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        });
        const permKeys = userRoles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.key));
        if (!permKeys.includes('user.manage')) {
          res.status(403).json({
            success: false,
            error: { message: 'Only the requester or a user with manage permissions can cancel this request.', statusCode: 403 },
          });
          return;
        }
      }

      const result = await borrowRequestService.cancelBorrowRequest(id, orgId, userId);
      res.json({
        success: true,
        data: serializeRequest(result),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to cancel borrow request.', statusCode },
      });
    }
  },
);

// ============================================================
// POST /:id/activate - Activate an approved borrow request
// ============================================================
router.post('/:id/activate',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const orgId = req.orgId!;
      const userId = req.userId!;

      const result = await borrowRequestService.activateBorrowRequest(id, orgId, userId);
      res.json({
        success: true,
        data: serializeRequest(result),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to activate borrow request.', statusCode },
      });
    }
  },
);

// ============================================================
// POST /:id/complete - Complete an active borrow request
// ============================================================
router.post('/:id/complete',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const orgId = req.orgId!;
      const userId = req.userId!;

      const result = await borrowRequestService.completeBorrowRequest(id, orgId, userId);
      res.json({
        success: true,
        data: serializeRequest(result),
      });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: { message: error.message || 'Failed to complete borrow request.', statusCode },
      });
    }
  },
);

export default router;
