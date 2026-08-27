import { Router, Response } from 'express';
import { db } from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ============================================================
// GET / - List departments with head user info
// ============================================================
router.get('/',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const departments = await db.department.findMany({
        where: { orgId: req.orgId! },
        include: {
          head: {
            select: {
              id: true,
              fullName: true,
              email: true,
              jobTitle: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.json({ success: true, data: departments });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to list departments.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST / - Create department
// ============================================================
router.post('/',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, headUserId } = req.body;
      const orgId = req.orgId!;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: { message: 'Department name is required.', statusCode: 400 },
        });
        return;
      }

      // If headUserId provided, validate it belongs to the same org
      if (headUserId) {
        const headUser = await db.user.findFirst({ where: { id: headUserId, orgId } });
        if (!headUser) {
          res.status(400).json({
            success: false,
            error: { message: 'Head user does not exist or does not belong to your organization.', statusCode: 400 },
          });
          return;
        }

        // Check if user is already head of another department
        const existingHead = await db.department.findFirst({ where: { headUserId } });
        if (existingHead) {
          res.status(409).json({
            success: false,
            error: { message: 'This user is already the head of another department.', statusCode: 409 },
          });
          return;
        }
      }

      const department = await db.department.create({
        data: {
          orgId,
          name: name.trim(),
          headUserId: headUserId || null,
        },
        include: {
          head: {
            select: {
              id: true,
              fullName: true,
              email: true,
              jobTitle: true,
              avatarUrl: true,
            },
          },
        },
      });

      res.status(201).json({ success: true, data: department });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to create department.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// PUT /:id - Update department
// ============================================================
router.put('/:id',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;
      const { name, headUserId } = req.body;

      // Check department exists in org
      const dept = await db.department.findFirst({ where: { id, orgId } });
      if (!dept) {
        res.status(404).json({
          success: false,
          error: { message: 'Department not found.', statusCode: 404 },
        });
        return;
      }

      // If headUserId provided, validate
      if (headUserId !== undefined && headUserId !== null) {
        const headUser = await db.user.findFirst({ where: { id: headUserId, orgId } });
        if (!headUser) {
          res.status(400).json({
            success: false,
            error: { message: 'Head user does not exist or does not belong to your organization.', statusCode: 400 },
          });
          return;
        }

        // Check if user is already head of another department
        const existingHead = await db.department.findFirst({
          where: { headUserId, id: { not: id } },
        });
        if (existingHead) {
          res.status(409).json({
            success: false,
            error: { message: 'This user is already the head of another department.', statusCode: 409 },
          });
          return;
        }
      }

      const updateData: any = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: { message: 'Department name cannot be empty.', statusCode: 400 },
          });
          return;
        }
        updateData.name = name.trim();
      }
      if (headUserId !== undefined) {
        updateData.headUserId = headUserId;
      }

      const updated = await db.department.update({
        where: { id },
        data: updateData,
        include: {
          head: {
            select: {
              id: true,
              fullName: true,
              email: true,
              jobTitle: true,
              avatarUrl: true,
            },
          },
        },
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to update department.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// DELETE /:id - Delete department (only if no users depend on it)
// ============================================================
router.delete('/:id',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;

      const dept = await db.department.findFirst({ where: { id, orgId } });
      if (!dept) {
        res.status(404).json({
          success: false,
          error: { message: 'Department not found.', statusCode: 404 },
        });
        return;
      }

      await db.department.delete({ where: { id } });

      res.json({ success: true, data: { id } });
    } catch (error: any) {
      // Prisma error for foreign key constraint
      if (error.code === 'P2003') {
        res.status(409).json({
          success: false,
          error: { message: 'Cannot delete department: there are users or resources that depend on it.', statusCode: 409 },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to delete department.', statusCode: 500 },
      });
    }
  },
);

export default router;
