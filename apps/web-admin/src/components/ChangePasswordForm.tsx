import { type FormEvent, useState } from 'react';
import { api, errMsg } from '../api/client';

const MIN_PW = 12;
/** Cung quy tac voi may chu (services/api auth/password-policy.ts); may chu van la nguon quyet dinh. */
export const pwHint = (pw: string): string | null => {
  if (pw.length < MIN_PW) return `Mật khẩu mới tối thiểu ${MIN_PW} ký tự.`;
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Mật khẩu mới cần có chữ hoa, chữ thường và chữ số.';
  return null;
};

/** Doi mat khau: dung o Profile (tu nguyen) va o Login (bat buoc, `forced`). Thanh cong: may chu huy cac phien khac va xoa co bat buoc. */
export function ChangePasswordForm({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const bad = pwHint(nw) ?? (nw !== again ? 'Nhập lại mật khẩu mới không khớp.' : null) ?? (nw === cur ? 'Mật khẩu mới phải khác mật khẩu hiện tại.' : null);
    if (bad) return setErr(bad);
    setBusy(true);
    try {
      await api.post('/auth/change-password', { body: { current_password: cur, new_password: nw } });
      setOk(true);
      setCur('');
      setNw('');
      setAgain('');
      onDone?.();
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Đổi mật khẩu">
      <div className="fd"><label htmlFor="pw-cur">Mật khẩu hiện tại</label><input id="pw-cur" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div className="fd"><label htmlFor="pw-new">Mật khẩu mới</label><input id="pw-new" type="password" autoComplete="new-password" required value={nw} onChange={(e) => setNw(e.target.value)} /></div>
      <div className="fd"><label htmlFor="pw-again">Nhập lại mật khẩu mới</label><input id="pw-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
      {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
      {ok && !forced ? <p role="status" style={{ margin: '10px 0 0' }}>Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.</p> : null}
      <div className="acts" style={{ marginTop: 14 }}><button className="btn p" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Đổi mật khẩu'}</button></div>
    </form>
  );
}
