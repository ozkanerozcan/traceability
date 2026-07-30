import { useEffect, type ReactNode } from 'react';
import { useAppStore } from '../../store/appStore';

/**
 * Uygulama açılışında data-theme attribute'unu ayarlar.
 * Sonraki tema değişimleri appStore.setTheme üzerinden uygulanır.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return <>{children}</>;
}