import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import tr from './locales/tr.json';
import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const stored = localStorage.getItem('mes_language') as Language | null;
const initialLanguage: Language = stored && SUPPORTED_LANGUAGES.includes(stored) ? stored : 'tr';

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'tr',
  interpolation: {
    escapeValue: false,
  },
});

export function setLanguage(lang: Language): void {
  localStorage.setItem('mes_language', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;