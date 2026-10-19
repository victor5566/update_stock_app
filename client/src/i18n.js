import { useEffect } from 'react';
import { TRANSLATIONS } from './translations';

// The UI is English only (the user, 2026-10-19: the Chinese interface and the language switch were
// removed). Components read text with useT(); the keys stay, so text is still kept in one place.
export function useT() {
  return (key) => TRANSLATIONS.en[key];
}

// The document title for a page.
export function useTitle(titleKey) {
  useEffect(() => {
    document.title = TRANSLATIONS.en[titleKey];
  }, [titleKey]);
}
