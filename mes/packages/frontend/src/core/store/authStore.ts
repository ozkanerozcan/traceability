import { create } from 'zustand';

export type Role = 'admin' | 'supervisor' | 'operator';

export interface User {
  id: number;
  username: string;
  role: Role;
  displayName: string | null;
  language: string;
  theme: string;
  isActive: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, token: string) => void;
  setUser: (user: User) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

/**
 * Auth state: JWT token bellekte tutulur (WebSocket bağlantısı için gerekli),
 * HTTP istekleri httpOnly cookie üzerinden doğrulanır.
 * Sayfa yenilendiğinde /api/auth/me ile oturum geri yüklenir.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  setAuth: (user, token) => set({ user, token, isAuthenticated: true, isLoading: false }),
  setUser: (user) => set({ user }),
  clearAuth: () => set({ user: null, token: null, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));