import { Response, NextFunction } from 'express';
import { db } from '../prisma';
import { AuthRequest } from './auth';

/**
 * Audit logging middleware.
 * Records an audit log entry after the response is sent.
 */
export function auditLog(action: string, entityType: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // Capture the original json method to intercept the response
    const originalJson = res.json.bind(res);
    let responseBody: unknown;

    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const entityId = (req.params?.id as string) || '';
      const metadata: Record<string, unknown> = {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      };

      // Only log successful operations (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.userId && req.orgId) {
        db.auditLog
          .create({
            data: {
              orgId: req.orgId,
              actorUserId: req.userId,
              action,
              entityType,
              entityId,
              metadata: JSON.stringify(metadata),
            },
          })
          .catch(() => {
            // Silently fail audit logging to not break request flow
          });
      }
    });

    next();
  };
}
