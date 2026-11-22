import { useMemo, useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../api/client';
import { Btn, Note } from './ui';

/** QR tạo ngay trên trình duyệt từ otpauth_url (máy chủ không gửi ảnh, khóa không rời trang). */
export function TotpQr({ url, size = 176 }: { url: string; size?: number }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createDataURL(4, 8);
  }, [url]);
  return <img src={svg} alt="Mã QR thiết lập xác thực hai bước" width={size} height={size} style={{ display: 'block', margin: '12px auto', background: '#fff', borderRadius: 8, imageRendering: 'pixelated' }} />;
}

/** Bật xác thực hai bước (TOTP) cho tài khoản đang đăng nhập. */
export function MfaSetup() {
  const { me, enrollMfa, reload } = useAuth();
  const [st, setSt] = useState<{ secret: string; otpauth_url?: string; mfa_token?: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const on = me.user.mfa_enabled !== false;

  const start = async () => {
    setErr(''); setBusy(true);
    try { setSt(await enrollMfa()); } catch (e) { setErr(e instanceof Error ? e.message : 'Không lấy được khóa thiết lập.'); } finally { setBusy(false); }
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (!st?.mfa_token) return;
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/mfa/verify', { body: { mfa_token: st.mfa_token, code: code.replace(/\s/g, '') }, quiet401: true });
      setSt(null); setCode('');
      await reload();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Mã không đúng.'); } finally { setBusy(false); }
  };

  return (
    <div id="mfa-setup">
      <div className="ch" style={{ marginTop: 18 }}><h2>Xác thực hai bước (TOTP)</h2></div>
      {on ? <p style={{ margin: '6px 0 0' }}>Đang bật. Mã 6 số lấy trong ứng dụng xác thực (Google Authenticator, Authy, Microsoft Authenticator…) trên điện thoại của bạn, đổi mỗi 30 giây. Dùng mã này khi lưu cấu hình SePay và các thao tác tiền.</p> : st ? (
        <form onSubmit={confirm}>
          <Note>Mở ứng dụng xác thực, chọn thêm tài khoản, quét mã QR (hoặc nhập khóa bên dưới), rồi nhập mã 6 số đang hiện.</Note>
          {st.otpauth_url ? <TotpQr url={st.otpauth_url} /> : null}
          <div className="fd"><label>Khóa thiết lập (nhập tay)</label><b className="mono" style={{ overflowWrap: 'anywhere' }}>{st.secret}</b></div>
          <div className="fd"><label htmlFor="mfa-code">Mã xác thực 6 số</label>
            <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} /></div>
          {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
          <div className="acts"><Btn tone="p" type="submit" disabled={busy}>Bật xác thực hai bước</Btn><Btn type="button" onClick={() => { setSt(null); setErr(''); }}>Hủy</Btn></div>
        </form>
      ) : (
        <>
          <Note warn>Tài khoản chưa bật xác thực hai bước nên chưa có mã 6 số. Cần bật để lưu cấu hình SePay và các thao tác tiền.</Note>
          {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
          <div className="acts"><Btn tone="p" onClick={() => void start()} disabled={busy}>Bật xác thực hai bước</Btn></div>
        </>
      )}
    </div>
  );
}
