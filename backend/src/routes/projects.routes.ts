import { Router, Response } from 'express';
import { db } from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ============================================================
// GET / - List projects with owner info (paginated, filtered)
// ============================================================
router.get('/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
      const statusFilter = req.query.status as string || '';

      const where: any = { orgId };
      if (statusFilter) {
        where.status = statusFilter;
      }

      const [projects, total] = await Promise.all([
        db.project.findMany({
          where,
          include: {
            owner: {
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
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.project.count({ where }),
      ]);

      res.json({
        success: true,
        data: {
          data: projects,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to list projects.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST / - Create project
// ============================================================
router.post('/',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, status } = req.body;
      const orgId = req.orgId!;
      const userId = req.userId!;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: { message: 'Project name is required.', statusCode: 400 },
        });
        return;
      }

      const project = await db.project.create({
        data: {
          orgId,
          name: name.trim(),
          status: status || 'active',
          ownerUserId: userId,
        },
        include: {
          owner: {
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

      res.status(201).json({ success: true, data: project });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to create project.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// PUT /:id - Update project (name, status)
// ============================================================
router.put('/:id',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;
      const { name, status } = req.body;

      const project = await db.project.findFirst({ where: { id, orgId } });
      if (!project) {
        res.status(404).json({
          success: false,
          error: { message: 'Project not found.', statusCode: 404 },
        });
        return;
      }

      // Authorization: owner or user.manage permission
      const isOwner = req.userId === project.ownerUserId;
      if (!isOwner) {
        const userRoles = await db.userRole.findMany({
          where: { userId: req.userId!, role: { orgId } },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        });
        const permKeys = userRoles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.key));
        if (!permKeys.includes('user.manage')) {
          res.status(403).json({
            success: false,
            error: { message: 'Only the project owner or a user with user.manage permission can update this project.', statusCode: 403 },
          });
          return;
        }
      }

      const updateData: any = {};
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          res.status(400).json({
            success: false,
            error: { message: 'Project name cannot be empty.', statusCode: 400 },
          });
          return;
        }
        updateData.name = name.trim();
      }
      if (status !== undefined) {
        updateData.status = status;
      }

      const updated = await db.project.update({
        where: { id },
        data: updateData,
        include: {
          owner: {
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
        error: { message: error.message || 'Failed to update project.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// DELETE /:id - Delete project (only if no active borrow requests)
// ============================================================
router.delete('/:id',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;

      const project = await db.project.findFirst({ where: { id, orgId } });
      if (!project) {
        res.status(404).json({
          success: false,
          error: { message: 'Project not found.', statusCode: 404 },
        });
        return;
      }

      // Authorization: owner or user.manage permission
      const isOwner = req.userId === project.ownerUserId;
      if (!isOwner) {
        const userRoles = await db.userRole.findMany({
          where: { userId: req.userId!, role: { orgId } },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        });
        const permKeys = userRoles.flatMap((ur: any) => ur.role.permissions.map((rp: any) => rp.permission.key));
        if (!permKeys.includes('user.manage')) {
          res.status(403).json({
            success: false,
            error: { message: 'Only the project owner or a user with user.manage permission can delete this project.', statusCode: 403 },
          });
          return;
        }
      }

      // Check for active borrow requests
      const activeBorrowRequests = await db.borrowRequest.count({
        where: {
          projectId: id,
          status: { in: ['pending', 'approved', 'active'] },
        },
      });

      if (activeBorrowRequests > 0) {
        res.status(409).json({
          success: false,
          error: { message: 'Cannot delete project: it has active or pending borrow requests.', statusCode: 409 },
        });
        return;
      }

      await db.project.delete({ where: { id } });

      res.json({ success: true, data: { id } });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to delete project.', statusCode: 500 },
      });
    }
  },
);

export default router;
