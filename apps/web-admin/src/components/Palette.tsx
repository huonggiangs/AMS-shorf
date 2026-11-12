import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { useAuth } from '../auth/AuthProvider';
import { PAGE_BY_ID } from '../nav';
import { api } from '../api/client';
import { campaignSchema, deviceSchema, listOf, userSchema } from '../api/schemas';

interface Item { g: string; l: string; s?: string; ic: string; run: () => void }

export function Palette({ pages, onClose }: { pages: string[]; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const { lang, setLang, toggleDark } = useUi();
  const { can, isExternal, logout } = useAuth();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [dq, setDq] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const h = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(h);
  }, [q]);

  const go = (path: string) => { onClose(); nav(path); };
  const search = <S extends typeof campaignSchema | typeof deviceSchema | typeof userSchema>(key: string, path: string, schema: S, ok: boolean) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ['palette', key, dq], enabled: ok && dq.length >= 1, staleTime: 15_000, queryFn: () => api.get(path, { query: { q: dq, page: 1, page_size: 5 }, schema: listOf(schema) }) });
  const camps = search('c', isExternal ? '/portal/v1/campaigns' : '/admin/v1/campaigns', campaignSchema, can('campaigns', 'view'));
  const devs = search('d', '/admin/v1/devices', deviceSchema, can('devices', 'view') && !isExternal);
  const usrs = search('u', '/admin/v1/users', userSchema, can('admin', 'view') && !isExternal);

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      ...pages.map((id) => ({ g: 'Trang', l: t(PAGE_BY_ID[id]!.label), ic: 'chev', run: () => go(PAGE_BY_ID[id]!.path) })),
      ...(can('campaigns', 'write') ? [{ g: 'Lệnh nhanh', l: t('Thêm quảng cáo'), ic: 'plus', run: () => go('/ads?new=1') }] : []),
      { g: 'Lệnh nhanh', l: t('Chế độ tối'), ic: 'moon', run: () => { onClose(); toggleDark(); } },
      { g: 'Lệnh nhanh', l: lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt', ic: 'gear', run: () => { onClose(); setLang(lang === 'vi' ? 'en' : 'vi'); } },
      { g: 'Lệnh nhanh', l: t('Xuất PDF'), ic: 'dl', run: () => { onClose(); setTimeout(() => window.print(), 50); } },
      { g: 'Lệnh nhanh', l: t('Đăng xuất'), ic: 'x', run: () => { onClose(); void logout(); } },
      ...(camps.data?.items ?? []).map((c) => ({ g: 'Quảng cáo', l: c.name, s: c.brand ?? undefined, ic: 'ads', run: () => go(`/ads?open=${encodeURIComponent(c.id)}`) })),
      ...(devs.data?.items ?? []).map((d) => ({ g: 'Thiết bị', l: d.name, s: d.owner_name ?? undefined, ic: 'tv', run: () => go(`/devices?open=${encodeURIComponent(d.id)}`) })),
      ...(usrs.data?.items ?? []).map((u) => ({ g: 'Người dùng', l: u.name ?? u.email, s: u.email, ic: 'user', run: () => go(`/access?user=${encodeURIComponent(u.id)}`) })),
    ];
    const ql = q.toLowerCase();
    return base.filter((x) => !ql || (`${x.l} ${x.s ?? ''}`).toLowerCase().includes(ql)).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pages, lang, camps.data, devs.data, usrs.data, can]);
  const cur = Math.min(i, Math.max(0, items.length - 1));

  return (
    <div className="pal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('Tìm kiếm hoặc nhập lệnh…')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(cur + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(cur - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); items[cur]?.run(); }
          else if (e.key === 'Escape') onClose();
        }}>
        <input ref={input} id="palq" placeholder={t('Tìm kiếm hoặc nhập lệnh…')} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} aria-label="search" />
        <ul>
          {items.map((x, k) => (
            <li key={`${x.g}-${k}`}>
              <button type="button" className={k === cur ? 'on' : ''} onClick={x.run} onMouseEnter={() => setI(k)}>
                <Icon n={x.ic} />
                {x.l}
                <small>{x.s ?? t(x.g)}</small>
              </button>
            </li>
          ))}
          {!items.length ? <li style={{ padding: 20, color: 'var(--mut)' }}>{t('Không có dữ liệu')}</li> : null}
        </ul>
      </div>
    </div>
  );
}
