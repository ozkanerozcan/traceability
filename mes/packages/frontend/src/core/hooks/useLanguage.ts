import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, type Language } from '../i18n';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

/**
 * Dil yönetimi: i18next dilini değiştirir, tercihi
 * localStorage + kullanıcı profiline (API) kaydeder.
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  const user = useAuthStore((s) => s.user);

  // İlk yüklemede: kullanıcı tercihi varsa onu kullan
  useEffect(() => {
    if (user?.language && user.language !== i18n.language) {
      setLanguage(user.language as Language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.language]);

  const changeLanguage = (lang: Language) => {
    setLanguage(lang);
    if (user) {
      void api.put('/api/auth/preferences', { language: lang }).catch(() => undefined);
    }
  };

  return { language: i18n.language as Language, setLanguage: changeLanguage };
}