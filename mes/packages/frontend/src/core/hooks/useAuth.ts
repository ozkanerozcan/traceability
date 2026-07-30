import { useCallback, useEffect } from 'react';
import { api } from '../services/api';
import { wsClient } from '../services/ws';
import { useAuthStore, type User } from '../store/authStore';

interface LoginResponse {
  user: User;
  token: string;
}

/**
 * Oturum geri yükleme: uygulama açılışında /api/auth/me çağrılarak
 * httpOnly cookie'deki oturum doğrulanır. App seviyesinde BİR KEZ çağrılmalıdır
 * (ProtectedRoute'dan önce çalışması gerekir — aksi halde yükleniyor ekranında kalır).
 */
export function useAuthRestore(): void {
  const clearAuth = useAuthStore((s) => s.clearAuth);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const data = await api.get<{ user: User }>('/api/auth/me');
        if (cancelled) return;

        // Oturum httpOnly cookie ile geri yüklendi; bellekteki JWT kaybolduğu için
        // WebSocket bağlantısını taze token ile yeniden kur (ws-token endpoint'i).
        try {
          const { token } = await api.post<{ token: string }>('/api/auth/ws-token');
          if (cancelled) return;
          useAuthStore.getState().setAuth(data.user, token);
          wsClient.connect(token);
        } catch {
          // WS token alınamazsa uygulama REST ile çalışmaya devam eder (gösterge Çevrimdışı kalır)
          useAuthStore.setState({ user: data.user, isAuthenticated: true, isLoading: false });
        }
      } catch {
        if (!cancelled) {
          clearAuth();
        }
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearAuth]);
}

/**
 * Kimlik doğrulama hook'u: login/logout işlemleri ve auth state erişimi.
 */
export function useAuth() {
  const { user, token, isAuthenticated, isLoading, setAuth, clearAuth, setLoading, setUser } =
    useAuthStore();

  const login = useCallback(
    async (username: string, password: string): Promise<void> => {
      const data = await api.post<LoginResponse>('/api/auth/login', { username, password });
      setAuth(data.user, data.token);
      wsClient.connect(data.token);
    },
    [setAuth]
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      wsClient.disconnect();
      clearAuth();
    }
  }, [clearAuth]);

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
    setLoading,
    setUser,
  };
}