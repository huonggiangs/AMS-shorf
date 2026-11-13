import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { sepaySettingsSchema } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { BANKS } from '../lib/sepay';
import { useUi } from '../state/ui';
import { Btn, CopyBtn, ErrorBlock, Field, LoadingBlock, Tag } from './ui';

/** Server returns only masked hints; the real key/secret never comes back. */
const connectSchema = sepaySettingsSchema.and(
  z.object({
    apikey_set: z.boolean().optional(),
    apikey_hint: z.string().nullish(),
    apikey_source: z.enum(['env', 'db']).nullish(),
    secret_set: z.boolean().optional(),
    secret_hint: z.string().nullish(),
    secret_source: z.enum(['env', 'db']).nullish(),
    account_holder: z.string().nullish(),
  }),
);
const testSchema = z
  .object({ ok: z.boolean(), signature_ok: z.boolean().optional(), apikey_ok: z.boolean().optional(), problems: z.array(z.string()).default([]), warnings: z.array(z.string()).default([]), message: z.string().optional(), mode: z.string().optional() })
  .passthrough();
type TestResult = z.infer<typeof testSchema>;

const KEY = ['/admin/v1/settings/sepay', 'connect'];
const CHANGES_KEY = ['/admin/v1/settings/sepay', 'changes'];
const changesSchema = z.object({ items: z.array(z.object({ id: z.string(), status: z.string(), requested_by: z.string(), requested_at: z.string(), changes: z.record(z.unknown()) }).passthrough()) });
const MODE_TEXT: Record<string, string> = {
  mock: 'mock: giả lập, không nhận tiền thật',
  sandbox: 'sandbox: thử nghiệm với SePay',
  production: 'production: nhận tiền thật',
};

export function SepayConnectCard() {
  const { can } = useAuth();
  const act = useAct();
  const { notify } = useUi();
  const canView = can('finance', 'view');
  const canEdit = can('finance', 'approve'); // trùng quyền PUT ở máy chủ (đổi nơi nhận tiền)
  const canTest = can('finance', 'write');
  const q = useQuery({ queryKey: KEY, enabled: canView, queryFn: () => api.get('/admin/v1/settings/sepay', { schema: connectSchema }) });
  const s = q.data;
  const pend = useQuery({ queryKey: CHANGES_KEY, enabled: canView, queryFn: () => api.get('/admin/v1/settings/sepay/changes', { schema: changesSchema }) });
  const pending = (pend.data?.items ?? []).filter((x) => x.status === 'pending');
  const [totp, setTotp] = useState('');

  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [account, setAccount] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [auth, setAuth] = useState<'hmac' | 'apikey'>('apikey');
  const [test, setTest] = useState<TestResult | { ok: false; problems: string[]; warnings: string[]; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s) return;
    setAccount(s.account_number ?? '');
    setHolder(s.account_holder ?? '');
    setBank(s.bank ?? '');
    setAuth(s.auth_mode === 'apikey' ? 'apikey' : 'hmac');
  }, [s]);

  if (!canView) return null;
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !s) return <ErrorBlock error={q.error ?? new Error('Không tải được cấu hình SePay.')} onRetry={() => void q.refetch()} />;

  const keyLocked = s.apikey_source === 'env';
  const secLocked = s.secret_source === 'env';
  const mode = s.env ?? 'production';
  const accountChanged = account !== (s.account_number ?? '');
  const accountBad = accountChanged && !/^[0-9]{6,20}$/.test(account);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (accountBad) return;
    const body: Record<string, unknown> = {};
    if (apiKey && !keyLocked) body['api_key'] = apiKey.trim();
    if (secret && !secLocked) body['webhook_secret'] = secret.trim();
    if (accountChanged && account) body['account_number'] = account;
    if (bank && bank !== (s.bank ?? '')) body['bank'] = bank;
    if (holder && holder !== (s.account_holder ?? '')) body['account_holder'] = holder;
    if (auth !== (s.auth_mode === 'apikey' ? 'apikey' : 'hmac')) body['auth_mode'] = auth;
    if (!Object.keys(body).length) return;
    if (!/^\d{6}$/.test(totp.trim())) { notify('Nhập mã xác thực 6 số (TOTP) để lưu thay đổi.'); return; }
    body['totp'] = totp.trim();
    const r = await act(() => api.put('/admin/v1/settings/sepay', { body }), (x) => ((x as { pending_change_id?: string | null })?.pending_change_id ? 'Đã gửi đề xuất đổi tài khoản nhận tiền. Cần một người khác duyệt trong 24 giờ.' : 'Đã lưu cấu hình SePay.'));
    if (r !== undefined) {
      setTotp('');
      await pend.refetch();
      setApiKey('');
      setSecret('');
      setShowKey(false);
      setShowSecret(false);
      setTest(null);
      await q.refetch();
    }
  };

  const clear = async (what: 'api_key' | 'webhook_secret') => {
    if (!/^\d{6}$/.test(totp.trim())) { notify('Nhập mã xác thực 6 số (TOTP) trước khi xóa khóa.'); return; }
    if (!window.confirm(what === 'api_key' ? 'Xóa API Key đã lưu? Webhook dùng API Key sẽ bị từ chối.' : 'Xóa khóa webhook đã lưu?')) return;
    const r = await act(() => api.put('/admin/v1/settings/sepay', { body: { [what]: '', totp: totp.trim() } }), 'Đã xóa khóa.');
    if (r !== undefined) {
      setTotp(''); setTest(null); await q.refetch(); }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      setTest(await api.post('/admin/v1/settings/sepay/test', { schema: testSchema }));
    } catch (err) {
      setTest({ ok: false, problems: [], warnings: [], message: err instanceof Error ? err.message : 'Không kiểm tra được kết nối.' });
    } finally {
      setBusy(false);
    }
  };

  const keyStatus = s.apikey_set ? `đã lưu ${s.apikey_hint ?? '••••'}${keyLocked ? ' (đặt từ máy chủ, không sửa ở đây)' : ''}` : 'chưa lưu';
  const secStatus = s.secret_set ? `đã lưu ${s.secret_hint ?? '••••'}${secLocked ? ' (đặt từ máy chủ, không sửa ở đây)' : ''}` : 'chưa lưu';

  return (
    <section className="card cp" aria-labelledby="sepay-connect-h" style={{ marginBottom: 18 }}>
      <div className="ch">
        <div>
          <h2 id="sepay-connect-h">Kết nối SePay</h2>
          <p>Dán API Key để SePay gọi webhook báo tiền vào ví. Khóa được mã hóa trong cơ sở dữ liệu và không bao giờ hiển thị lại.</p>
        </div>
        <Tag tone={s.apikey_set || s.secret_set ? 'ok' : 'warn'}>{s.apikey_set || s.secret_set ? 'Đã có khóa' : 'Chưa kết nối'}</Tag>
      </div>

      <dl className="kv" style={{ margin: '0 0 14px' }}>
        <dt>URL webhook</dt>
        <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{s.webhook_url || '— (chưa đặt SEPAY_WEBHOOK_URL)'} {s.webhook_url ? <CopyBtn text={s.webhook_url} label="Sao chép URL" /> : null}</dd>
        <dt>Chế độ</dt>
        <dd data-testid="sepay-mode">{MODE_TEXT[mode] ?? mode} <small style={{ color: 'var(--mut)' }}>· đặt bằng biến SEPAY_MODE ở máy chủ, không đổi ở trình duyệt để tránh mở nhầm mô phỏng trên hệ thống chạy tiền thật.</small></dd>
      </dl>

      <form onSubmit={save} autoComplete="off">
        <div className="g g2">
          <Field label="API Key" hint={`Hiện tại: ${keyStatus}. Để trống = giữ nguyên.`}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                aria-label="API Key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder={s.apikey_set ? `${s.apikey_hint ?? '••••'} (nhập để thay)` : 'Dán API Key tại đây'} disabled={!canEdit || keyLocked}
                autoComplete="new-password" spellCheck={false} style={{ flex: 1 }}
              />
              <button type="button" className="btn sm" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey} disabled={!apiKey}>{showKey ? 'Ẩn' : 'Hiện'}</button>
            </div>
            {canEdit && s.apikey_set && !keyLocked ? <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => void clear('api_key')}>Xóa API Key đã lưu</button> : null}
          </Field>
          <Field label="Khóa bí mật webhook (HMAC, tùy chọn)" hint={`Hiện tại: ${secStatus}. Chỉ cần nếu chọn xác thực HMAC-SHA256 bên SePay.`}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                aria-label="Khóa bí mật webhook" type={showSecret ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)}
                placeholder={s.secret_set ? `${s.secret_hint ?? '••••'} (nhập để thay)` : 'Tùy chọn'} disabled={!canEdit || secLocked}
                autoComplete="new-password" spellCheck={false} style={{ flex: 1 }}
              />
              <button type="button" className="btn sm" onClick={() => setShowSecret((v) => !v)} aria-pressed={showSecret} disabled={!secret}>{showSecret ? 'Ẩn' : 'Hiện'}</button>
            </div>
            {canEdit && s.secret_set && !secLocked ? <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => void clear('webhook_secret')}>Xóa khóa đã lưu</button> : null}
          </Field>
          <Field label="Kiểu xác thực webhook">
            <select aria-label="Kiểu xác thực webhook" value={auth} onChange={(e) => setAuth(e.target.value as 'hmac' | 'apikey')} disabled={!canEdit}>
              <option value="apikey">API Key (header Authorization: Apikey …)</option>
              <option value="hmac">HMAC-SHA256 (X-SePay-Signature)</option>
            </select>
          </Field>
          <Field label="Ngân hàng nhận tiền">
            <select aria-label="Ngân hàng" value={bank} onChange={(e) => setBank(e.target.value)} disabled={!canEdit}>
              <option value="">— chọn —</option>
              {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Số tài khoản" hint={accountBad ? 'Số tài khoản gồm 6-20 chữ số.' : 'Số tài khoản mẫu 0123456789 sẽ bị cảnh báo khi kiểm tra.'}>
            <input aria-label="Số tài khoản" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value.trim())} disabled={!canEdit} aria-invalid={accountBad} />
          </Field>
          <Field label="Tên chủ tài khoản">
            <input aria-label="Tên chủ tài khoản" value={holder} onChange={(e) => setHolder(e.target.value)} disabled={!canEdit} />
          </Field>
        </div>
        {canEdit ? (
          <div style={{ marginTop: 10, maxWidth: 320 }}>
            <Field label="Mã xác thực 6 số (TOTP)" hint="Bắt buộc để lưu, xóa khóa hoặc duyệt thay đổi. Đổi ngân hàng/số tài khoản cần thêm một người khác duyệt.">
              <input aria-label="Mã TOTP xác nhận" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
            </Field>
          </div>
        ) : null}
        <div className="acts" style={{ marginTop: 14 }}>
          {canEdit ? <Btn tone="p" type="submit" disabled={accountBad}>Lưu cấu hình</Btn> : <small style={{ color: 'var(--mut)' }}>Chỉ Super admin hoặc Kế toán có quyền duyệt mới được sửa.</small>}
          {canTest ? <Btn type="button" onClick={() => void runTest()} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}</Btn> : null}
        </div>
      </form>

      {pending.length ? (
        <div role="region" aria-label="Thay đổi chờ duyệt" className="note warn" style={{ margin: '14px 0 0', display: 'block' }}>
          <b>Đề xuất đổi tài khoản nhận tiền đang chờ người thứ hai duyệt</b>
          <ul style={{ margin: '6px 0 0 18px' }}>
            {pending.map((p) => (
              <li key={p.id}>
                {Object.entries(p.changes).map(([k, v]) => `${k}: ${String(v)}`).join(', ')} · đề xuất bởi {p.requested_by}
                {canEdit ? (
                  <span style={{ marginLeft: 8 }}>
                    <button type="button" className="btn sm" onClick={async () => {
                      if (!/^\d{6}$/.test(totp.trim())) { notify('Nhập mã xác thực 6 số (TOTP) để duyệt.'); return; }
                      const r = await act(() => api.post(`/admin/v1/settings/sepay/changes/${p.id}/approve`, { body: { totp: totp.trim() } }), 'Đã duyệt và áp dụng.');
                      if (r !== undefined) { setTotp(''); await Promise.all([pend.refetch(), q.refetch()]); }
                    }}>Duyệt</button>{' '}
                    <button type="button" className="btn sm" onClick={async () => {
                      const r = await act(() => api.post(`/admin/v1/settings/sepay/changes/${p.id}/reject`, { body: {} }), 'Đã từ chối đề xuất.');
                      if (r !== undefined) await pend.refetch();
                    }}>Từ chối</button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {test ? (
        <div role={test.ok ? 'status' : 'alert'} className={`note ${test.ok ? '' : 'warn'}`} style={{ margin: '14px 0 0', flexWrap: 'wrap' }}>
          <span>
            <b>{test.ok ? 'Kết nối hợp lệ' : 'Chưa kết nối được'}</b>{test.message ? `: ${test.message}` : ''}
            {test.problems.length ? <ul style={{ margin: '6px 0 0 18px' }}>{test.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
            {test.warnings.length ? <ul style={{ margin: '6px 0 0 18px' }}>{test.warnings.map((p) => <li key={p}>{p}</li>)}</ul> : null}
            <small style={{ display: 'block', marginTop: 4, color: 'var(--mut)' }}>Đây là kiểm tra nội bộ (không gọi sang SePay, không cộng tiền). Kết quả cuối cùng do nút “Gửi thử” trên my.sepay.vn.</small>
          </span>
        </div>
      ) : null}

      <details style={{ marginTop: 14 }}>
        <summary><b>Hướng dẫn 4 bước</b></summary>
        <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.6 }}>
          <li>Trên my.sepay.vn vào <b>Webhooks &gt; Thêm webhook</b>, dán <b>URL webhook</b> ở trên, sự kiện “Có tiền vào”.</li>
          <li>Chọn kiểu chứng thực <b>API Key</b>, tự đặt một chuỗi khóa (ví dụ khóa tên “AMS”) và dán đúng chuỗi đó vào ô API Key ở đây. Hoặc chọn HMAC-SHA256 và dán Secret vào ô khóa bí mật.</li>
          <li>Nhập ngân hàng, số tài khoản, tên chủ tài khoản đúng với tài khoản đã liên kết SePay, bấm <b>Lưu cấu hình</b>.</li>
          <li>Bấm <b>Kiểm tra kết nối</b> ở đây, rồi bấm <b>Gửi thử</b> bên SePay. Khách chuyển khoản với nội dung <span className="mono">{s.prefix} &lt;mã khách hàng&gt;</span> sẽ được cộng ví tự động.</li>
        </ol>
        <small style={{ color: 'var(--mut)' }}>Lưu ý: khóa API dùng để truy vấn dữ liệu SePay (my.sepay.vn &gt; Cấu hình &gt; API Access) khác với API Key của webhook ở bước 2. Ô này dành cho API Key của webhook.</small>
      </details>
    </section>
  );
}
