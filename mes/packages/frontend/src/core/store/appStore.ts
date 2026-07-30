import { create } from 'zustand';

export type Theme = 'dark' | 'light';

interface AppState {
  theme: Theme;
  sidebarCollapsed: boolean;
  wsConnected: boolean;
  companyName: string;
  logoPath: string;
  poweredByVisible: boolean;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setWsConnected: (connected: boolean) => void;
  setBranding: (branding: {
    companyName?: string;
    logoPath?: string;
    poweredByVisible?: boolean;
  }) => void;
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('mes_theme');
  return stored === 'light' ? 'light' : 'dark';
}

export const useAppStore = create<AppState>((set) => ({
  theme: getInitialTheme(),
  sidebarCollapsed: localStorage.getItem('mes_sidebar_collapsed') === 'true',
  wsConnected: false,
  companyName: 'OE',
  logoPath: '',
  poweredByVisible: true,
  setTheme: (theme) => {
    localStorage.setItem('mes_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed;
      localStorage.setItem('mes_sidebar_collapsed', String(collapsed));
      return { sidebarCollapsed: collapsed };
    }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setBranding: (branding) =>
    set((state) => ({
      companyName: branding.companyName ?? state.companyName,
      logoPath: branding.logoPath ?? state.logoPath,
      poweredByVisible: branding.poweredByVisible ?? state.poweredByVisible,
    })),
}));