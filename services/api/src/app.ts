import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { ZodError } from 'zod';
import { bumpOpsCounter, type Runtime } from '@ams/runtime';
import { isInvalidTransition } from '@ams/shared';
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
import { historyRoutes, portalHistoryRoutes } from './routes/history.js';
import { invoiceRoutes, payoutRoutes, portalInvoiceRoutes } from './routes/invoices.js';
import { mediaRoutes } from './routes/media.js';
import { opsRoutes, publicOpsRoutes } from './routes/ops.js';
import { storageRoutes, STORAGE_UPLOAD_PATH } from './routes/storage.js';
import { partnerRoutes } from './routes/partners.js';
import { portalRoutes } from './routes/portal.js';
import { revenueRoutes } from './routes/revenue.js';
import { rtbFloorRoutes } from './routes/rtb-floors.js';
import { scheduleRoutes } from './routes/schedule.js';
import { screenRoutes } from './routes/screens.js';
import { tvExperienceRoutes } from './routes/tv-experience.js';
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
  const jsonLimit = bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Nội dung gửi lên quá lớn.' } }, 413),
  });
  // PUT /storage/upload/* (OBJECT_STORE=fs) co gioi han rieng theo chu ky URL (routes/storage.ts)
  app.use('*', (c, next) => (c.req.path.startsWith(STORAGE_UPLOAD_PATH) ? next() : jsonLimit(c, next)));

  app.get('/health', (c) => c.json({ ok: true, service: 'ams-api', runtime: rt.config.runtime }));

  // p3-ops: dem 5xx cua webhook thanh toan (kiem tra canh bao webhook:5xx)
  app.use('/webhooks/*', async (c, next) => {
    await next();
    if (c.res.status >= 500) await bumpOpsCounter(rt, 'sepay_webhook_5xx');
  });
  app.route('/', publicOpsRoutes()); // GET /status (cong khai), POST /ops/backup-report (Bearer OPS_REPORT_TOKEN)
  app.route('/storage', storageRoutes());
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
  // w2-notconnected: man hinh truoc day NotConnected
  admin.route('/history', historyRoutes());
  admin.route('/tv-experience', tvExperienceRoutes());
  admin.route('/invoices', invoiceRoutes());
  admin.route('/payouts', payoutRoutes());
  admin.route('/ops', opsRoutes());
  app.route('/admin/v1', admin);
  app.route('/portal/v1/history', portalHistoryRoutes());
  app.route('/portal/v1/invoices', portalInvoiceRoutes());
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
    // chuyen trang thai chien dich khong hop le / thua cuoc dua (packages/shared/src/campaign-state.ts)
    if (isInvalidTransition(err)) return c.json({ error: { code: 'invalid_state', message: err.message } }, 409);
    if (err instanceof ZodError) return c.json({ error: { code: 'validation_error', message: 'Dữ liệu không hợp lệ.', details: err.flatten() } }, 422);
    const status = (err as { status?: number }).status;
    if (status === 413) return c.json({ error: { code: 'payload_too_large', message: 'Nội dung gửi lên quá lớn.' } }, 413);
    // khong ro ri chi tiet; ghi ten loi, khong ghi noi dung (tranh PII)
    void bumpOpsCounter(rt, 'api_5xx');
    console.error('[api] loi khong xu ly:', err.name, c.req.method, new URL(c.req.url).pathname);
    return c.json({ error: { code: 'internal_error', message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại.' } }, 500);
  });
  return app;
}
