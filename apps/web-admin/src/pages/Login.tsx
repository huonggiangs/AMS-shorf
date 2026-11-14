import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api, errMsg, setCsrfToken } from '../api/client';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Icon } from '../components/Icon';
import { Note } from '../components/ui';
import { useT } from '../i18n';
import { useUi } from '../state/ui';

type Step = 'creds' | 'enroll' | 'mfa' | 'change';

export default function Login() {
  const t = useT();
  const ui = useUi();
  const { status, expired, login, enrollMfa, reload } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [step, setStep] = useState<Step>('creds');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_url?: string; qr_url?: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // giu nguoi dung o trang dang nhap trong luc kiem tra co buoc doi mat khau bat buoc (tranh Navigate truoc khi biet ket qua)
  const [hold, setHold] = useState(false);

  if (status === 'authed' && !hold && step !== 'change') return <Navigate to={loc.state?.from && loc.state.from !== '/login' ? loc.state.from : '/'} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setHold(false);
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCreds = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setHold(true);
      const r = await login(email.trim(), password);
      if (!r.mfa_required) {
        if (r.must_change_password === true) setStep('change');
        else setHold(false);
        return;
      }
      setHold(false); // buoc MFA: chua co phien, khong can giu
      if (r.mfa_required) {
        setMfaToken(r.mfa_token ?? '');
        if (r.mfa_enroll_required) {
          setEnroll(await enrollMfa());
          setStep('enroll');
        } else setStep('mfa');
      }
    });
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setHold(true);
      // goi truc tiep de doc `must_change_password` (verifyMfa cua AuthProvider bo qua phan hoi)
      const r = (await api.post('/auth/mfa/verify', { body: { mfa_token: mfaToken, code: code.replace(/\s/g, '') }, quiet401: true })) as { must_change_password?: boolean; csrf_token?: string };
      if (r.csrf_token) setCsrfToken(r.csrf_token);
      if (r.must_change_password === true) {
        setStep('change');
        return;
      }
      await reload();
      setHold(false);
    });
  };

  return (
    <div className={`tvn ${ui.dark ? 'dark' : ''}`} style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <main style={{ width: 'min(420px,100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, justifyContent: 'center' }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--pri)', color: '#fff', display: 'grid', placeItems: 'center' }}>
            <Icon n="tv" />
          </span>
          <b style={{ fontSize: 22 }}>AMS</b>
        </div>
        <div className="card cp">
          <h1 style={{ margin: '0 0 4px', fontSize: 20 }}>{t('Đăng nhập')}</h1>
          <p className="sub" style={{ margin: '0 0 14px' }}>Bảng điều hành quảng cáo màn hình</p>
          {expired && step === 'creds' ? <Note warn>Phiên đã hết hạn hoặc tài khoản được đăng nhập ở nơi khác. Vui lòng đăng nhập lại.</Note> : null}
          {step === 'change' ? (
            <div>
              <Note warn>Tài khoản này bắt buộc đổi mật khẩu trước khi sử dụng. Mật khẩu mới cần tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và chữ số.</Note>
              <ChangePasswordForm forced onDone={() => { void reload().finally(() => { setHold(false); setStep('creds'); }); }} />
            </div>
          ) : step === 'creds' ? (
            <form onSubmit={submitCreds}>
              <div className="fd">
                <label htmlFor="lg-email">Email</label>
                <input id="lg-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="fd">
                <label htmlFor="lg-pw">{t('Mật khẩu')}</label>
                <input id="lg-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
              <div className="acts" style={{ marginTop: 16 }}>
                <button className="btn p" type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? t('Đang tải…') : t('Đăng nhập')}</button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitCode}>
              {step === 'enroll' && enroll ? (
                <div style={{ marginBottom: 12 }}>
                  <Note>Tài khoản bắt buộc bật xác thực hai bước (TOTP). Thêm khóa vào ứng dụng xác thực (Google Authenticator, Authy…) rồi nhập mã 6 số.</Note>
                  {enroll.qr_url ? <img src={enroll.qr_url} alt="QR TOTP" width={160} height={160} style={{ display: 'block', margin: '12px auto', background: '#fff', borderRadius: 8 }} /> : null}
                  <div className="fd"><label>Khóa thiết lập</label><b className="mono" style={{ overflowWrap: 'anywhere' }}>{enroll.secret}</b></div>
                  {enroll.otpauth_url ? <a href={enroll.otpauth_url}>Mở trong ứng dụng xác thực</a> : null}
                </div>
              ) : null}
              <div className="fd">
                <label htmlFor="lg-code">{t('Mã xác thực 6 số')}</label>
                <input id="lg-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
              <div className="acts" style={{ marginTop: 16 }}>
                <button className="btn p" type="submit" disabled={busy}>{t('Xác nhận')}</button>
                <button className="btn" type="button" onClick={() => { setStep('creds'); setCode(''); setErr(''); }}>{t('Quay lại')}</button>
              </div>
            </form>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
          <button type="button" className="pill lang" onClick={() => ui.setLang(ui.lang === 'vi' ? 'en' : 'vi')}>{ui.lang === 'vi' ? 'VI' : 'EN'}</button>
          <button type="button" className="ib" onClick={ui.toggleDark} aria-label="dark"><Icon n="moon" /></button>
        </div>
      </main>
    </div>
  );
}
