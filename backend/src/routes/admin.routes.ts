import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { runStateMachineTick } from '../services/state-machine.service';

const router = Router();

// ============================================================
// POST /state-machine/tick - Manually trigger state machine
// ============================================================
router.post('/state-machine/tick',
  authenticate,
  requirePermission('org.manage'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const result = await runStateMachineTick();
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'State machine tick failed.', statusCode: 500 },
      });
    }
  },
);

export default router;
