import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { validate } from '../middleware/validate';
import { auditLog } from '../middleware/audit';

const router = Router();

const registerSchema = z.object({
  orgName: z.string().min(2).max(100),
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post(
  '/register',
  validate(registerSchema),
  auditLog('user.register', 'user'),
  async (req: Request, res: Response) => {
    try {
      const body = req.body as z.infer<typeof registerSchema>;      
      const result = await authService.register(body);
      res.status(201).json({ success: true, data: result });
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      const statusCode = err.statusCode || 500;
      const message = err.message || 'Registration failed.';
      res.status(statusCode).json({
        success: false,
        error: { message, statusCode },
      });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  validate(loginSchema),
  async (req: Request, res: Response) => {
    console.log('Request from frontend: ', req.body);
    
    try {
      const body = req.body as z.infer<typeof loginSchema>;
      console.log('Body in try catch: ', body);

      const result = await authService.login(body);
      console.log('Result in try: ', result);
      
      res.status(200).json({ success: true, data: result });
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      console.log('Error in catch pakro: ', err);

      const statusCode = err.statusCode || 500;
      const message = err.message || 'Login failed.';
      res.status(statusCode).json({
        success: false,
        error: { message, statusCode },
      });
    }
  }
);

export default router;
