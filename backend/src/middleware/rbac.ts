import { Response, NextFunction } from 'express';
import { db } from '../prisma';
import { AuthRequest } from './auth';

/**
 * Middleware factory: requirePermission(permissionKey)
 * Checks if the authenticated user's roles contain the given permission.
 */
export function requirePermission(permissionKey: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId || !req.orgId) {
      res.status(401).json({
        success: false,
        error: { message: 'Authentication required.', statusCode: 401 },
      });
      return;
    }

    try {
      // Fetch all permissions for the user's roles within their org
      const userRoles = await db.userRole.findMany({
        where: {
          userId: req.userId,
          role: { orgId: req.orgId },
        },
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      });

      const allPermissionKeys = userRoles.flatMap((ur: any) =>
        ur.role.permissions.map((rp: any) => rp.permission.key)
      );

      if (!allPermissionKeys.includes(permissionKey)) {
        res.status(403).json({
          success: false,
          error: {
            message: `Insufficient permissions. Required: ${permissionKey}`,
            statusCode: 403,
          },
        });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { message: 'Error checking permissions.', statusCode: 500 },
      });
    }
  };
}
