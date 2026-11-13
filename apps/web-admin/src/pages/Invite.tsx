import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { useAuth } from '../auth/AuthProvider';
import { api, errMsg, setCsrfToken } from '../api/client';
import { enrollSchema } from '../api/schemas';
import { Icon } from '../components/Icon';
import { Note } from '../components/ui';
import { useUi } from '../state/ui';

/** Quy tac mat khau (cung quy tac doi mat khau): >= 12 ky tu, chu hoa + chu thuong + chu so. */
export const PW_RULES: { id: string; label: string; ok: (p: string) => boolean }[] = [
  { id: 'len', label: 'Tối thiểu 12 ký tự', ok: (p) => p.length >= 12 },
  { id: 'up', label: 'Có chữ hoa', ok: (p) => /[A-Z]/.test(p) },
  { id: 'low', label: 'Có chữ thường', ok: (p) => /[a-z]/.test(p) },
  { id: 'dig', label: 'Có chữ số', ok: (p) => /\d/.test(p) },
];
export const pwStrength = (p: string): number => PW_RULES.filter((r) => r.ok(p)).length;
export const pwError = (p: string): string | null => (PW_RULES.every((r) => r.ok(p)) ? null : 'Mật khẩu cần tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và chữ số.');

/** Ve ma QR (SVG data URL) tu otpauth://. */
export function qrDataUrl(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createDataURL(5, 2);
}

interface InviteInfo { email?: string; name?: string; role?: string; customer_name?: string }
type Step = 'password' | 'totp';

export function AcceptInvite({ internal }: { internal: boolean }) {
  const ui = useUi();
  const nav = useNavigate();
  const { reload } = useAuth();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [step, setStep] = useState<Step>('password');
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_url?: string | undefined } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Thong tin nguoi duoc moi: diem cuoi GET /auth/invite/info (neu may chu co) - khong co thi bo qua.
  useEffect(() => {
    if (!token) return;
    let off = false;
    api.get('/auth/invite/info', { query: { token }, quiet401: true }).then((r) => { if (!off && r && typeof r === 'object') setInfo(r as InviteInfo); }, () => undefined);
    return () => { off = true; };
  }, [token]);

  const qr = useMemo(() => {
    if (!enroll?.otpauth_url) return '';
    try { return qrDataUrl(enroll.otpauth_url); } catch { return ''; }
  }, [enroll]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try { await fn(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    const bad = pwError(pw);
    if (bad) return setErr(bad);
    if (pw !== pw2) return setErr('Hai mật khẩu không khớp.');
    void run(async () => {
      const r = (await api.post('/auth/invite/accept', { body: { token, password: pw }, quiet401: true })) as { mfa_token?: string };
      const t = r.mfa_token ?? '';
      setMfaToken(t);
      setEnroll(await api.post('/auth/mfa/enroll', { body: t ? { mfa_token: t } : {}, schema: enrollSchema, quiet401: true }));
      setStep('totp');
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = (await api.post('/auth/mfa/verify', { body: { mfa_token: mfaToken, code: code.replace(/\s/g, '') }, quiet401: true })) as { csrf_token?: string };
      if (r.csrf_token) setCsrfToken(r.csrf_token);
      await reload();
      nav('/', { replace: true });
    });
  };

  const who = info?.name || info?.email;
  return (
    <div className={`tvn ${ui.dark ? 'dark' : ''}`} style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <main style={{ width: 'min(440px,100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, justifyContent: 'center' }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--pri)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon n="tv" /></span>
          <b style={{ fontSize: 22 }}>AMS</b>
        </div>
        <div className="card cp">
          <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>{internal ? 'Kích hoạt tài khoản nhân sự' : 'Kích hoạt tài khoản khách hàng'}</h1>
          {!token ? (
            <>
              <p role="alert" style={{ color: 'var(--bad)' }}>Liên kết không hợp lệ: thiếu mã mời. Hãy mở đúng liên kết trong email hoặc nhờ quản trị viên gửi lại lời mời.</p>
              <Link to="/login">Về trang đăng nhập</Link>
            </>
          ) : step === 'password' ? (
            <form onSubmit={submitPassword} noValidate>
              <p className="sub" style={{ margin: '0 0 12px' }} data-testid="invite-who">
                {who ? <>Bạn được mời tham gia hệ thống AMS: <b>{who}</b>{info?.email && info.name ? ` (${info.email})` : ''}{info?.customer_name ? ` · ${info.customer_name}` : ''}.</> : 'Bạn được mời tham gia hệ thống AMS.'} Hãy đặt mật khẩu{internal ? ' và bật xác thực hai bước (TOTP)' : ', sau đó bật xác thực hai bước (TOTP)'} để kích hoạt.
              </p>
              <div className="fd">
                <label htmlFor="iv-pw">Mật khẩu mới</label>
                <input id="iv-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="iv-rules" />
              </div>
              <ul id="iv-rules" style={{ listStyle: 'none', margin: '4px 0 8px', padding: 0, fontSize: 13 }}>
                {PW_RULES.map((r) => <li key={r.id} style={{ color: r.ok(pw) ? 'var(--ok)' : 'var(--mut)' }}>{r.ok(pw) ? '✓' : '○'} {r.label}</li>)}
              </ul>
              <meter min={0} max={4} low={2} high={3} optimum={4} value={pwStrength(pw)} aria-label="Độ mạnh mật khẩu" style={{ width: '100%' }} />
              <div className="fd">
                <label htmlFor="iv-pw2">Nhập lại mật khẩu</label>
                <input id="iv-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </div>
              {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
              <div className="acts" style={{ marginTop: 16 }}>
                <button className="btn p" type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Đang xử lý…' : 'Đặt mật khẩu và tiếp tục'}</button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitCode}>
              <Note>Quét mã QR bằng ứng dụng xác thực (Google Authenticator, Authy…) hoặc nhập khóa thủ công, rồi nhập mã 6 số để hoàn tất.</Note>
              {qr ? <img src={qr} alt="Mã QR TOTP" width={180} height={180} style={{ display: 'block', margin: '12px auto', background: '#fff', borderRadius: 8 }} /> : null}
              {enroll ? <div className="fd"><label>Khóa thiết lập</label><b className="mono" data-testid="totp-secret" style={{ overflowWrap: 'anywhere' }}>{enroll.secret}</b></div> : null}
              <div className="fd">
                <label htmlFor="iv-code">Mã xác thực 6 số</label>
                <input id="iv-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
              <div className="acts" style={{ marginTop: 16 }}>
                <button className="btn p" type="submit" disabled={busy} style={{ width: '100%' }}>Xác nhận và vào hệ thống</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Invite() {
  return <AcceptInvite internal={false} />;
}
