import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Aktif dili <html lang> attribute'una yansıtır.
 * i18n başlatması core/i18n/index.ts içinde yapılır.
 */
export default function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.setAttribute('lang', i18n.language);
  }, [i18n.language]);

  return <>{children}</>;
}