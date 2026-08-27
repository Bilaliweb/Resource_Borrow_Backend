import { Router, Response } from 'express';
import { db } from '../prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/dashboard/kpis
router.get('/kpis', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.orgId!;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [
      totalRequests,
      pendingRequests,
      activeRequests,
      completedRequests,
      totalThisMonth,
    ] = await Promise.all([
      db.borrowRequest.count({ where: { orgId } }),
      db.borrowRequest.count({ where: { orgId, status: 'pending' } }),
      db.borrowRequest.count({ where: { orgId, status: 'active' } }),
      db.borrowRequest.count({ where: { orgId, status: 'completed' } }),
      db.borrowRequest.count({
        where: {
          orgId,
          createdAt: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
        },
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRequests,
        pendingRequests,
        activeRequests,
        completedRequests,
        totalThisMonth,
      },
    });
  } catch (error) {
    console.error('Dashboard KPI error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch dashboard KPIs.', statusCode: 500 },
    });
  }
});

export default router;
