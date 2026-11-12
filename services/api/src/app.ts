import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import type { Runtime } from '@ams/runtime';
import { HttpError } from './lib/errors.js';
import { clientIp } from './lib/http.js';
import { authenticate, csrfGuard, requireExternal, requireInternal } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { nullFinancePort } from './ports.js';
import type { FinancePort, MountFinance } from './ports.js';
import { approvalRoutes } from './routes/approvals.js';
import { auditRoutes } from './routes/audit-log.js';
import { campaignRoutes } from './routes/campaigns.js';
import { contractRoutes } from './routes/contracts.js';
import { customerRoutes } from './routes/customers.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { deviceRoutes } from './routes/devices.js';
import { mediaRoutes } from './routes/media.js';
import { partnerRoutes } from './routes/partners.js';
import { portalRoutes } from './routes/portal.js';
import { revenueRoutes } from './routes/revenue.js';
import { rtbFloorRoutes } from './routes/rtb-floors.js';
import { scheduleRoutes } from './routes/schedule.js';
import { screenRoutes } from './routes/screens.js';
import { permissionRoutes, userRoutes } from './routes/users.js';
import type { AppEnv } from './types.js';

export interface AppOptions {
  /** Gan route tai chinh (a2). Mac dinh: khong co, dung nullFinancePort. */
  mountFinance?: MountFinance;
  /** Ghi de FinancePort (kiem thu). */
  finance?: FinancePort;
}

/** Ung dung Hono khong phu thuoc runtime: Docker, Workers va kiem thu deu dung chung. */
export function createApp(rt: Runtime, opts: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  let financePort: Promise<FinancePort> = Promise.resolve(opts.finance ?? nullFinancePort);

  app.use('*', async (c, next) => {
    c.set('rt', rt);
    c.set('ip', clientIp(c));
    c.set('finance', () => financePort);
    await next();
  });
  app.use('*', secureHeaders({ referrerPolicy: 'no-referrer', crossOriginResourcePolicy: 'same-site' }));
  app.use('*', async (c, next) => {
    await next();
    // phan hoi API khong duoc cache o trung gian (co du lieu theo phien)
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Nội dung gửi lên quá lớn.' } }, 413),
    }),
  );

  app.get('/health', (c) => c.json({ ok: true, service: 'ams-api', runtime: rt.config.runtime }));

  app.route('/auth', authRoutes());

  // Chuoi middleware phai dang ky TRUOC khi mountFinance gan route /admin/v1/* va /portal/v1/* cua a2.
  app.use('/admin/v1/*', authenticate, requireInternal, csrfGuard);
  app.use('/portal/v1/*', authenticate, requireExternal, csrfGuard);

  const admin = new Hono<AppEnv>();
  admin.route('/devices', deviceRoutes());
  admin.route('/campaigns', campaignRoutes(false));
  admin.route('/customers', customerRoutes());
  admin.route('/contracts', contractRoutes());
  admin.route('/approvals', approvalRoutes());
  admin.route('/media', mediaRoutes(false));
  admin.route('/screens', screenRoutes());
  admin.route('/schedule', scheduleRoutes());
  admin.route('/users', userRoutes());
  admin.route('/permissions', permissionRoutes());
  admin.route('/audit-log', auditRoutes());
  admin.route('/dashboard', dashboardRoutes());
  admin.route('/revenue', revenueRoutes());
  admin.route('/partners', partnerRoutes());
  admin.route('/rtb-floors', rtbFloorRoutes());
  app.route('/admin/v1', admin);
  app.route('/portal/v1', portalRoutes());

  if (opts.mountFinance) {
    const p = opts.mountFinance(app, rt);
    financePort = Promise.resolve(p);
  }

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Không tìm thấy đường dẫn.' } }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
      return c.json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }, err.status);
    }
    if (err instanceof ZodError) return c.json({ error: { code: 'validation_error', message: 'Dữ liệu không hợp lệ.', details: err.flatten() } }, 422);
    const status = (err as { status?: number }).status;
    if (status === 413) return c.json({ error: { code: 'payload_too_large', message: 'Nội dung gửi lên quá lớn.' } }, 413);
    // khong ro ri chi tiet; ghi ten loi, khong ghi noi dung (tranh PII)
    console.error('[api] loi khong xu ly:', err.name, c.req.method, new URL(c.req.url).pathname);
    return c.json({ error: { code: 'internal_error', message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' } }, 500);
  });
  return app;
}
