import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { db } from '../prisma';
import * as availabilityService from '../services/availability.service';

const router = Router();

// ============================================================
// GET /:userId - Get employee availability
// ============================================================
router.get('/:userId',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.params.userId as string;
      const orgId = req.orgId!;
      const date = req.query.date as string | undefined;

      // Validate user exists in org
      const user = await db.user.findFirst({
        where: { id: userId, orgId },
        select: { id: true },
      });
      if (!user) {
        res.status(404).json({
          success: false,
          error: { message: 'User not found in your organization.', statusCode: 404 },
        });
        return;
      }

      const result = await availabilityService.getEmployeeAvailability(userId, orgId, date);
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch availability.', statusCode: 500 },
      });
    }
  },
);

export default router;
