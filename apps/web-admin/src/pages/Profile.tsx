import { type FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { api, errMsg } from '../api/client';
import { Btn, Note, PageHead, StatusTag } from '../components/ui';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { ROLE_LABEL } from '../lib/status';
import { fmtDateTime } from '../lib/format';

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

export default function Profile() {
  const t = useT();
  const ui = useUi();
  const { me, logout, isExternal, mustChangePassword: forced, reload } = useAuth();
  if (!me) return null;
  const u = me.user;
  const name = u.name || u.email;
  return (
    <>
      <PageHead title="Hồ sơ của tôi" sub="Thông tin tài khoản và tùy chọn hiển thị." />
      {forced ? <Note warn>Tài khoản của bạn bắt buộc đổi mật khẩu. Các chức năng khác bị khóa cho đến khi bạn đổi mật khẩu bên dưới.</Note> : null}
      <div className="g g2">
        <div className="card cp">
          <div className="nm" style={{ marginBottom: 18 }}>
            <span className="av" style={{ width: 56, height: 56, fontSize: 18 }}>{name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div><b style={{ fontSize: 18 }}>{name}</b><small>{ROLE_LABEL[u.role] ?? u.role}{me.customer_scope?.name ? ` · ${me.customer_scope.name}` : ''}</small></div>
          </div>
          <StatusTag status="cooperating" />
          <dl className="kv">
            <dt>Email</dt><dd>{u.email}</dd>
            <dt>Đăng nhập gần nhất</dt><dd>{fmtDateTime(u.last_login_at)}</dd>
            <dt>Bảo mật</dt><dd>{u.mfa_enabled === false ? 'Chưa bật xác thực hai bước' : 'Xác thực hai bước đang bật'}</dd>
            {isExternal ? (<><dt>Phạm vi</dt><dd>Chỉ dữ liệu của khách hàng được cấp</dd></>) : null}
          </dl>
          <div className="acts" style={{ marginTop: 12 }}>
            <Btn onClick={() => void logout()}>{t('Đăng xuất')}</Btn>
            <Btn onClick={() => void logout()}>Đăng nhập tài khoản khác</Btn>
          </div>
        </div>
        <div className="card cp">
          <div className="ch"><h2>Tùy chọn</h2></div>
          <label style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0' }}>{t('Chế độ tối')}<input type="checkbox" className="tgl" checked={ui.dark} onChange={ui.toggleDark} /></label>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
            {t('Ngôn ngữ')}
            <select className="sel" value={ui.lang} onChange={(e) => ui.setLang(e.target.value as 'vi' | 'en')} aria-label={t('Ngôn ngữ')}><option value="vi">Tiếng Việt</option><option value="en">English</option></select>
          </div>
          <div className="ch" style={{ marginTop: 18 }}><h2>Đổi mật khẩu</h2></div>
          <ChangePasswordForm onDone={() => { void reload(); }} />
        </div>
      </div>
    </>
  );
}
