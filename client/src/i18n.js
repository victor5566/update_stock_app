import { createContext, useContext, useEffect, useState } from 'react';
import { TRANSLATIONS } from './translations';

// The current language ('zh' / 'en'); pages provide it, components read text with useT().
export const LangContext = createContext('zh');

export function useT() {
  const lang = useContext(LangContext);
  return (key) => TRANSLATIONS[lang][key];
}

// The language choice for a page: remembered in localStorage (which can throw in private
// windows), and reflected in <html lang> and the document title.
export function useLang(titleKey) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('lang') === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    document.title = TRANSLATIONS[lang][titleKey];
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // the choice just isn't remembered
    }
  }, [lang, titleKey]);
  return [lang, setLang];
}
