import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { config } from './config';

import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import borrowRequestsRoutes from './routes/borrow-requests.routes';
import approvalsRoutes from './routes/approvals.routes';
import notificationsRoutes from './routes/notifications.routes';
import dashboardRoutes from './routes/dashboard.routes';
import departmentsRoutes from './routes/departments.routes';
import projectsRoutes from './routes/projects.routes';
import organizationsRoutes from './routes/organizations.routes';
import availabilityRoutes from './routes/availability.routes';
import auditRoutes from './routes/audit.routes';
import adminRoutes from './routes/admin.routes';
import { startStateMachineCron } from './services/state-machine.service';

const app = express();

// ---- Global Middleware ----
app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

// ---- Health Check ----
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    },
  });
});

// ---- Routes ----
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/borrow-requests', borrowRequestsRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/admin', adminRoutes);

// ---- 404 Handler ----
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Not found.',
      statusCode: 404,
    },
  });
});

// ---- Global Error Handler ----
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      message: config.env === 'production' ? 'Internal server error.' : err.message || 'Internal server error.',
      statusCode: 500,
    },
  });
});

// ---- Start Server ----
app.listen(config.port, () => {
  console.log(`\n🚀 Resource Borrow Platform API`);
  console.log(`   Env: ${config.env}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Health: http://localhost:${config.port}/api/health\n`);

  // Start state machine cron (auto-activate, auto-complete)
  if (config.env !== 'test') {
    startStateMachineCron(60_000); // every 60 seconds
    console.log('   State machine cron: ACTIVE (60s interval)\n');
  }
});

export default app;
