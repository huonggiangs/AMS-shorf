import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useAuth } from '../auth/AuthProvider';
import { Btn, Note, PageHead, StatusTag } from '../components/ui';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { ROLE_LABEL } from '../lib/status';
import { fmtDateTime } from '../lib/format';

export { ChangePasswordForm, pwHint } from '../components/ChangePasswordForm';

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
