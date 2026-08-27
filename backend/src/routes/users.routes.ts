import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

const SALT_ROUNDS = 12;

// Helper: serialize user (strip passwordHash)
function serializeUser(user: any) {
  const { passwordHash, ...safe } = user;
  return safe;
}

// ============================================================
// GET / - List org users (paginated, filtered)
// ============================================================
router.get('/',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
      const search = (req.query.search as string || '').trim();
      const roleFilter = req.query.role as string || '';
      const statusFilter = req.query.status as string || '';

      // Build where clause
      const where: any = { orgId };

      if (search) {
        where.OR = [
          { fullName: { contains: search } },
          { email: { contains: search } },
          { jobTitle: { contains: search } },
        ];
      }

      if (roleFilter) {
        where.roles = {
          some: {
            role: { name: roleFilter },
          },
        };
      }

      if (statusFilter === 'active') {
        where.isActive = true;
      } else if (statusFilter === 'inactive') {
        where.isActive = false;
      }

      const [users, total] = await Promise.all([
        db.user.findMany({
          where,
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.user.count({ where }),
      ]);

      const serialized = users.map((u) => ({
        ...serializeUser(u),
        roles: u.roles.map((ur) => ur.role),
      }));

      res.json({
        success: true,
        data: {
          data: serialized,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to list users.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// POST / - Invite/create user
// ============================================================
router.post('/',
  authenticate,
  requirePermission('user.invite'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { fullName, email, password, jobTitle, roleIds } = req.body;
      const orgId = req.orgId!;

      if (!fullName || !email || !password) {
        res.status(400).json({
          success: false,
          error: { message: 'fullName, email, and password are required.', statusCode: 400 },
        });
        return;
      }

      // Check email uniqueness
      const existing = await db.user.findFirst({ where: { email } });
      if (existing) {
        res.status(409).json({
          success: false,
          error: { message: 'A user with this email already exists.', statusCode: 409 },
        });
        return;
      }

      // Validate roleIds belong to org
      if (roleIds && roleIds.length > 0) {
        const rolesCount = await db.role.count({
          where: { id: { in: roleIds }, orgId },
        });
        if (rolesCount !== roleIds.length) {
          res.status(400).json({
            success: false,
            error: { message: 'One or more role IDs are invalid or do not belong to your organization.', statusCode: 400 },
          });
          return;
        }
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const user = await db.user.create({
        data: {
          orgId,
          email,
          passwordHash,
          fullName,
          jobTitle: jobTitle || null,
          roles: roleIds && roleIds.length > 0
            ? { create: roleIds.map((roleId: string) => ({ roleId })) }
            : undefined,
        },
        include: {
          roles: { include: { role: true } },
        },
      });

      res.status(201).json({
        success: true,
        data: {
          ...serializeUser(user),
          roles: user.roles.map((ur) => ur.role),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to create user.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// GET /me - Current user profile with roles & permissions
// ============================================================
router.get('/me',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await db.user.findUnique({
        where: { id: req.userId! },
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: { permission: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          error: { message: 'User not found.', statusCode: 404 },
        });
        return;
      }

      const roles = user.roles.map((ur) => ur.role);
      const permissions = roles.flatMap((r) =>
        r.permissions.map((rp) => rp.permission),
      );
      // Deduplicate permissions by id
      const uniquePermissions = permissions.filter(
        (p, i, arr) => arr.findIndex((x) => x.id === p.id) === i,
      );

      res.json({
        success: true,
        data: {
          ...serializeUser(user),
          roles,
          permissions: uniquePermissions,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch profile.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// GET /roles - List org roles (with permissions)
// ============================================================
router.get('/roles',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    console.log('Request: ', req.orgId);
    try {
      const orgId = req.orgId!;

      const roles = await db.role.findMany({
        where: { orgId },
        include: {
          permissions: {
            include: { permission: true },
            orderBy: { permission: { key: 'asc' } },
          },
        },
        orderBy: { name: 'asc' },
      });

      const data = roles.map((r) => ({
        id: r.id,
        name: r.name,
        isSystemRole: r.isSystemRole,
        permissions: r.permissions.map((rp) => rp.permission),
      }));

      res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch roles.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// GET /:id - Get user by ID
// ============================================================
router.get('/:id',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;

      // Users can view their own profile
      const isOwnProfile = req.userId === id;

      if (!isOwnProfile) {
        // Check user.manage permission (handled by rbac)
        // For simplicity, we check roles from token
        const hasPermission = await (async () => {
          const userRoles = await db.userRole.findMany({
            where: { userId: req.userId!, role: { orgId } },
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          });
          const permKeys = userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key));
          return permKeys.includes('user.manage');
        })();

        if (!hasPermission) {
          res.status(403).json({
            success: false,
            error: { message: 'You can only view your own profile or need user.manage permission.', statusCode: 403 },
          });
          return;
        }
      }

      const user = await db.user.findFirst({
        where: { id, orgId },
        include: {
          roles: { include: { role: true } },
        },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          error: { message: 'User not found.', statusCode: 404 },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          ...serializeUser(user),
          roles: user.roles.map((ur) => ur.role),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch user.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// PUT /:id - Update user
// ============================================================
router.put('/:id',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;
      const { fullName, jobTitle, avatarUrl, isActive } = req.body;

      // Check user exists in org
      const target = await db.user.findFirst({ where: { id, orgId } });
      if (!target) {
        res.status(404).json({
          success: false,
          error: { message: 'User not found.', statusCode: 404 },
        });
        return;
      }

      // Authorization: own profile or user.manage permission
      const isOwnProfile = req.userId === id;
      let canUpdate = isOwnProfile;

      if (!canUpdate) {
        const userRoles = await db.userRole.findMany({
          where: { userId: req.userId!, role: { orgId } },
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        });
        const permKeys = userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key));
        canUpdate = permKeys.includes('user.manage');
      }

      if (!canUpdate) {
        res.status(403).json({
          success: false,
          error: { message: 'You can only update your own profile or need user.manage permission.', statusCode: 403 },
        });
        return;
      }

      // Non-owners cannot set isActive (only user.manage holders can)
      if (isActive !== undefined && !isOwnProfile) {
        // Only user.manage holders can toggle isActive — already checked above
      } else if (isActive !== undefined && isOwnProfile) {
        // Users cannot deactivate themselves
        delete req.body.isActive;
      }

      const updateData: any = {};
      if (fullName !== undefined) updateData.fullName = fullName;
      if (jobTitle !== undefined) updateData.jobTitle = jobTitle;
      if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
      if (isActive !== undefined && !isOwnProfile) updateData.isActive = isActive;

      const updated = await db.user.update({
        where: { id },
        data: updateData,
        include: {
          roles: { include: { role: true } },
        },
      });

      res.json({
        success: true,
        data: {
          ...serializeUser(updated),
          roles: updated.roles.map((ur) => ur.role),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to update user.', statusCode: 500 },
      });
    }
  },
);

// ============================================================
// PUT /:id/roles - Assign roles to user
// ============================================================
router.put('/:id/roles',
  authenticate,
  requirePermission('user.manage'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const orgId = req.orgId!;
      const { roleIds } = req.body;

      if (!Array.isArray(roleIds)) {
        res.status(400).json({
          success: false,
          error: { message: 'roleIds must be an array of role IDs.', statusCode: 400 },
        });
        return;
      }

      // Check user exists in org
      const target = await db.user.findFirst({ where: { id, orgId } });
      if (!target) {
        res.status(404).json({
          success: false,
          error: { message: 'User not found.', statusCode: 404 },
        });
        return;
      }

      // Validate roleIds belong to org
      if (roleIds.length > 0) {
        const rolesCount = await db.role.count({
          where: { id: { in: roleIds }, orgId },
        });
        if (rolesCount !== roleIds.length) {
          res.status(400).json({
            success: false,
            error: { message: 'One or more role IDs are invalid or do not belong to your organization.', statusCode: 400 },
          });
          return;
        }
      }

      // Replace all roles (delete existing, create new)
      await db.userRole.deleteMany({ where: { userId: id } });

      if (roleIds.length > 0) {
        await db.userRole.createMany({
          data: roleIds.map((roleId: string) => ({ userId: id, roleId })),
        });
      }

      const updated = await db.user.findUnique({
        where: { id },
        include: {
          roles: { include: { role: true } },
        },
      });

      res.json({
        success: true,
        data: {
          ...serializeUser(updated!),
          roles: updated!.roles.map((ur) => ur.role),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to assign roles.', statusCode: 500 },
      });
    }
  },
);

export default router;
