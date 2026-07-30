import { useEffect } from 'react';
import { useAppStore, type Theme } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

/**
 * Tema yönetimi: data-theme attribute'u uygular, tercihi
 * localStorage + kullanıcı profiline (API) kaydeder.
 */
export function useTheme() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);

  // İlk yüklemede: kullanıcı tercihi varsa onu kullan
  useEffect(() => {
    if (user?.theme && user.theme !== theme) {
      setTheme(user.theme as Theme);
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.theme]);

  const changeTheme = (next: Theme) => {
    setTheme(next);
    // Giriş yapmış kullanıcının tercihini kalıcı kaydet (hata yoksayılır)
    if (user) {
      void api.put('/api/auth/preferences', { theme: next }).catch(() => undefined);
    }
  };

  return { theme, setTheme: changeTheme };
}