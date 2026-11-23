import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { Palette } from './Palette';
import { loadRead, saveRead, useNotifications } from './Notifications';
import { useAuth } from '../auth/AuthProvider';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { GROUPS, PAGE_BY_ID, PAGE_DEFS, groupOf, visiblePages } from '../nav';
import { ROLE_LABEL } from '../lib/status';

const OPEN_KEY = 'ams-nav-open';
const loadOpen = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const saveOpen = (ids: string[]) => {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
};

const initials = (s: string) => s.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || 'U';

export function Shell() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const ui = useUi();
  const { me, can, isExternal, logout } = useAuth();
  const [pal, setPal] = useState(false);
  const [notif, setNotif] = useState(false);
  const [open, setOpen] = useState<string[]>(loadOpen);
  const [read, setRead] = useState<Record<string, number>>(loadRead);
  const pages = useMemo(() => visiblePages(can, isExternal), [can, isExternal]);
  const { items } = useNotifications();
  const unread = items.filter((n) => (read[n.id] ?? -1) !== n.count);

  const cur = PAGE_DEFS.find((p) => loc.pathname.startsWith(p.path))?.id ?? 'overview';
  const grp = groupOf(cur);
  // profile is reachable via the avatar for everyone; it only counts as a menu entry next to other pages
  const groups = GROUPS.map((g) => ({ g, pages: g.pages.filter((p) => pages.includes(p) && p !== 'profile') })).filter((x) => x.pages.length);
  const pendingBadge = items.find((n) => n.id === 'approvals')?.count ?? 0;
  const name = me?.user.name || me?.user.email || '';

  useEffect(() => { ui.setMenuOpen(false); setNotif(false); window.scrollTo?.(0, 0); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); }
      if (e.key === 'Escape') { setPal(false); setNotif(false); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // The group holding the current page is expanded on arrival; the user may still collapse it. Other groups follow the remembered toggles.
  const [shut, setShut] = useState<string | null>(null);
  useEffect(() => { setShut(null); }, [grp.id]);
  const isOpen = (id: string) => (id === grp.id ? shut !== id : open.includes(id));
  const toggle = (id: string) => {
    if (id === grp.id) { setShut(shut === id ? null : id); return; }
    const next = open.includes(id) ? open.filter((x) => x !== id) : [...open, id];
    setOpen(next);
    saveOpen(next);
  };
  const flyAt = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--fly-top', `${Math.max(8, Math.round(r.top))}px`);
  };
  return (
    <div className={`tvn ${ui.dark ? 'dark' : ''} ${ui.col ? 'col' : ''}`}>
      <a href="#page" className="sr-skip" style={{ position: 'absolute', left: -9999 }}>{t('Bỏ qua tới nội dung')}</a>
      {ui.menuOpen ? <div className="scrim" onClick={() => ui.setMenuOpen(false)} /> : null}
      <aside className={`side ${ui.menuOpen ? 'open' : ''}`} aria-label="menu">
        <div className="logo">
          <i><Icon n="tv" /></i>
          <b>AMS<small>Bảng điều hành</small></b>
        </div>
        <nav className="ngs" aria-label={t('Điều hướng chính')}>
          {groups.map(({ g, pages: gp }) => {
            const badge = g.id === 'g2' && pendingBadge ? <em>{pendingBadge}</em> : null;
            if (gp.length === 1) {
              const only = PAGE_BY_ID[gp[0]!]!;
              return (
                <Link key={g.id} to={only.path} className={`nv ${grp.id === g.id ? 'on' : ''}`} title={t(g.label)} aria-current={cur === only.id ? 'page' : undefined}>
                  <Icon n={g.icon} /><span>{t(g.label)}</span>{badge}
                </Link>
              );
            }
            const expanded = isOpen(g.id);
            return (
              <div key={g.id} className={`ng ${expanded ? 'open' : ''}`} onMouseEnter={flyAt} onFocus={flyAt}>
                <button type="button" id={`nvh-${g.id}`} className={`nv ${grp.id === g.id ? 'on' : ''}`} title={t(g.label)} aria-expanded={expanded} aria-controls={`nvs-${g.id}`} onClick={() => toggle(g.id)}>
                  <Icon n={g.icon} />
                  <span>{t(g.label)}</span>
                  {badge}
                  <Icon n="chev" className="cv" />
                </button>
                <ul id={`nvs-${g.id}`} className="sub" hidden={!expanded} aria-labelledby={`nvh-${g.id}`}>
                  <li className="fh" aria-hidden="true">{t(g.label)}</li>
                  {gp.map((p) => (
                    <li key={p}>
                      <Link to={PAGE_BY_ID[p]!.path} className={`sl ${cur === p ? 'on' : ''}`} aria-current={cur === p ? 'page' : undefined}>
                        <span>{t(PAGE_BY_ID[p]!.label)}</span>
                        {p === 'approvals' && pendingBadge ? <em>{pendingBadge}</em> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sp" />
        <button type="button" className="nv" onClick={ui.toggleCol}>
          <Icon n="menu" />
          <span>{t(ui.col ? 'Mở rộng menu' : 'Thu gọn menu')}</span>
        </button>
        <div className="me">
          <span className="av">{initials(name)}</span>
          <div>{name}<small>{ROLE_LABEL[me?.user.role ?? ''] ?? me?.user.role}</small></div>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button type="button" className="ib mob" onClick={() => ui.setMenuOpen(!ui.menuOpen)} aria-label="menu"><Icon n="menu" /></button>
          <button type="button" className="kb" onClick={() => setPal(true)}>
            <Icon n="search" /><span>{t('Tìm kiếm hoặc nhập lệnh…')}</span><kbd>Ctrl K</kbd>
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="pill lang" onClick={() => ui.setLang(ui.lang === 'vi' ? 'en' : 'vi')} aria-label="language">{ui.lang === 'vi' ? 'VI' : 'EN'}</button>
          <button type="button" className="ib" onClick={ui.toggleDark} aria-label="dark" aria-pressed={ui.dark}><Icon n="moon" /></button>
          <button type="button" className="ib" onClick={() => setNotif((n) => !n)} aria-label={t('Thông báo')} aria-expanded={notif}>
            <Icon n="bell" />
            {unread.length ? <i>{unread.length}</i> : null}
          </button>
          <button type="button" className="av" style={{ border: 0 }} onClick={() => nav('/profile')} aria-label="profile">{initials(name)}</button>
          {notif ? (
            <div className="pop" role="dialog" aria-label={t('Thông báo')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
                <b>{t('Thông báo')}</b>
                <button type="button" className="pill" onClick={() => { const r = { ...read }; items.forEach((n) => { r[n.id] = n.count; }); setRead(r); saveRead(r); }}>{t('Đánh dấu đã đọc')}</button>
              </div>
              {items.map((n) => {
                const u = (read[n.id] ?? -1) !== n.count;
                return (
                  <button key={n.id} type="button" className={`it ${u ? 'u' : ''}`} style={{ width: '100%', textAlign: 'left', border: 0, borderTop: '1px solid var(--line)', background: u ? 'var(--pri-t)' : 'none' }}
                    onClick={() => { const r = { ...read, [n.id]: n.count }; setRead(r); saveRead(r); setNotif(false); nav(n.page); }}>
                    <div><b style={{ fontWeight: 600 }}>{n.text}</b><small>{n.sub}</small></div>
                  </button>
                );
              })}
              {!items.length ? <div style={{ padding: '18px', color: 'var(--mut)', borderTop: '1px solid var(--line)' }}>{t('Không có dữ liệu')}</div> : null}
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
                <button type="button" className="btn sm" onClick={() => void logout()}>{t('Đăng xuất')}</button>
              </div>
            </div>
          ) : null}
        </header>
        <div className="cnt" id="page">
          <Outlet />
        </div>
      </div>
      {pal ? <Palette pages={pages} onClose={() => setPal(false)} /> : null}
      {ui.toast ? <div className="tst" role="status">{ui.toast}</div> : null}
    </div>
  );
}
