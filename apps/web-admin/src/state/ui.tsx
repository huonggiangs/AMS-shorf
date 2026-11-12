import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { I18nProvider, type Lang } from '../i18n';

const KEY = 'ams-ui';
const load = (): { lang: Lang; dark: boolean; col: boolean } => {
  const d = { lang: 'vi' as Lang, dark: false, col: false };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (o.lang === 'vi' || o.lang === 'en') d.lang = o.lang;
    if (typeof o.dark === 'boolean') d.dark = o.dark;
    else if (typeof window.matchMedia === 'function') d.dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (typeof o.col === 'boolean') d.col = o.col;
  } catch {
    /* storage unavailable: defaults */
  }
  return d;
};

interface UiCtx {
  lang: Lang;
  dark: boolean;
  col: boolean;
  menuOpen: boolean;
  toast: string;
  setLang: (l: Lang) => void;
  toggleDark: () => void;
  toggleCol: () => void;
  setMenuOpen: (b: boolean) => void;
  notify: (m: string) => void;
}
const Ctx = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const init = useMemo(load, []);
  const [lang, setLang] = useState<Lang>(init.lang);
  const [dark, setDark] = useState(init.dark);
  const [col, setCol] = useState(init.col);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const timer = useRef<number>();
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, dark, col }));
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang, dark, col]);
  const notify = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(''), 2800);
  }, []);
  const value: UiCtx = {
    lang, dark, col, menuOpen, toast, setLang, setMenuOpen, notify,
    toggleDark: () => setDark((d) => !d),
    toggleCol: () => setCol((c) => !c),
  };
  return (
    <Ctx.Provider value={value}>
      <I18nProvider lang={lang}>{children}</I18nProvider>
    </Ctx.Provider>
  );
}
export const useUi = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('UiProvider missing');
  return c;
}
