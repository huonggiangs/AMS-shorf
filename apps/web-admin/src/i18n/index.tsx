import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { EN } from './en';
import { EXTRA } from './extra';

export type Lang = 'vi' | 'en';
const DICT: Record<string, string> = { ...EN, ...EXTRA };

export const translate = (lang: Lang, s: string): string => (lang === 'en' ? (DICT[s] ?? s) : s);

const Ctx = createContext<{ lang: Lang; t: (s: string) => string }>({ lang: 'vi', t: (s) => s });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const v = useMemo(() => ({ lang, t: (s: string) => translate(lang, s) }), [lang]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx).lang;
