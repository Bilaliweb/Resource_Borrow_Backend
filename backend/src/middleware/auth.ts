import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../prisma';

export interface AuthRequest extends Request {
  userId?: string;
  orgId?: string;
  roles?: string[];
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { message: 'Authentication required. Please provide a Bearer token.', statusCode: 401 },
    });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      orgId: string;
      roles: string[];
    };

    // Verify user still exists and is active
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, orgId: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({
        success: false,
        error: { message: 'User not found or inactive.', statusCode: 401 },
      });
      return;
    }

    req.userId = payload.userId;
    req.orgId = payload.orgId;
    req.roles = payload.roles;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: { message: 'Token expired. Please log in again.', statusCode: 401 },
      });
      return;
    }
    res.status(401).json({
      success: false,
      error: { message: 'Invalid or malformed token.', statusCode: 401 },
    });
  }
}
