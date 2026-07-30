import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ClipboardList,
  BookOpen,
  Cpu,
  Users,
  Settings,
  ScrollText,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  Languages,
  Factory,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useLanguage } from '../../hooks/useLanguage';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useAppStore } from '../../store/appStore';

interface NavItem {
  to: string;
  icon: React.ReactNode;
  labelKey: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: <LayoutDashboard size={18} />, labelKey: 'nav.dashboard' },
  { to: '/work-orders', icon: <ClipboardList size={18} />, labelKey: 'nav.workOrders' },
  { to: '/recipes', icon: <BookOpen size={18} />, labelKey: 'nav.recipes' },
  { to: '/plc', icon: <Cpu size={18} />, labelKey: 'nav.plc' },
  { to: '/users', icon: <Users size={18} />, labelKey: 'nav.users', adminOnly: true },
  { to: '/settings', icon: <Settings size={18} />, labelKey: 'nav.settings', adminOnly: true },
  { to: '/audit', icon: <ScrollText size={18} />, labelKey: 'nav.audit', adminOnly: true },
];

/** Kullanıcı adından avatar baş harfleri üretir (örn. "Ahmet Yılmaz" → "AY") */
function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Viewport mobil (drawer) modda mı — CSS breakpoint'i ile senkron (1023px) */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 1023px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export default function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const wsConnected = useWebSocket();
  const { sidebarCollapsed, toggleSidebar, companyName, poweredByVisible } = useAppStore();

  const isMobile = useIsMobile();

  // Mobil drawer + kullanıcı menüsü durumu
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Mobil ↔ masaüstü geçişinde drawer'ı sıfırla (drawer açıkken
  // pencere büyürse içerik çekmece arkasında kalmasın)
  useEffect(() => {
    if (!isMobile) setMobileMenuOpen(false);
  }, [isMobile]);

  // Kullanıcı menüsü: dışarı tıklama / Escape ile kapat
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [userMenuOpen]);

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

  const displayName = user?.displayName ?? user?.username ?? '';

  // Minimize butonu: mobilde drawer'ı kapatır, masaüstünde sidebar'ı daraltır/genişletir
  const collapseVisible = !isMobile || mobileMenuOpen;

  return (
    <div className="app-shell">
      {/* Mobil drawer karartması */}
      <div
        className={`sidebar-overlay${mobileMenuOpen ? ' open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`sidebar${!isMobile && sidebarCollapsed ? ' collapsed' : ''}${mobileMenuOpen ? ' mobile-open' : ''}`}
        aria-label={t('common.appName')}
      >
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">
            <Factory size={18} />
          </span>
          <span className="sidebar-brand-text">{companyName} MES</span>
          {collapseVisible && !sidebarCollapsed && (
            <button
              className="btn-icon sidebar-collapse-btn"
              onClick={() => (isMobile ? setMobileMenuOpen(false) : toggleSidebar())}
              title={isMobile ? t('sidebar.close') : t('sidebar.collapse')}
              aria-label={isMobile ? t('sidebar.close') : t('sidebar.collapse')}
            >
              {isMobile ? <X size={18} /> : <PanelLeftClose size={18} />}
            </button>
          )}
        </div>


        <nav className="sidebar-nav">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              title={t(item.labelKey)}
              onClick={() => setMobileMenuOpen(false)}
            >
              {item.icon}
              <span className="sidebar-link-label">{t(item.labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          {/* Masaüstü + daraltılmış: expand butonu sidebar'ın en altında */}
          {!isMobile && sidebarCollapsed && (
            <button
              className="btn-icon sidebar-expand-btn"
              onClick={toggleSidebar}
              title={t('sidebar.expand')}
              aria-label={t('sidebar.expand')}
            >
              <PanelLeftOpen size={18} />
            </button>
          )}
          {poweredByVisible && (
            <div className="sidebar-footer">{t('poweredBy')}</div>
          )}
        </div>
      </aside>


      <div className="app-main">
        <header className="header">
          {isMobile && (
            <button
              className="btn-icon header-menu-btn"
              onClick={() => setMobileMenuOpen(true)}
              title={t('sidebar.menu')}
              aria-label={t('sidebar.menu')}
            >
              <Menu size={20} />
            </button>
          )}

          <div className="header-title">{t('common.appName')}</div>

          <div className="header-actions">
            <span
              className={`badge ${wsConnected ? 'badge-success' : 'badge-muted'}`}
              title={wsConnected ? t('ws.connected') : t('ws.disconnected')}
            >
              <span className={`status-dot${wsConnected ? ' status-dot-pulse' : ''}`} />
              {wsConnected ? t('ws.live') : t('ws.offline')}
            </span>

            <button
              className="btn-icon"
              onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
              title={t(`language.${language === 'tr' ? 'en' : 'tr'}`)}
              aria-label={t(`language.${language === 'tr' ? 'en' : 'tr'}`)}
            >
              <Languages size={18} />
            </button>

            <button
              className="btn-icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={t(`theme.${theme === 'dark' ? 'light' : 'dark'}`)}
              aria-label={t(`theme.${theme === 'dark' ? 'light' : 'dark'}`)}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* Kullanıcı menüsü */}
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="user-menu-trigger"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="user-avatar">{userInitials(displayName)}</span>
                <span className="user-menu-meta">
                  <span className="user-menu-name">{displayName}</span>
                  <span className="user-menu-role">{t(`user.${user?.role}`)}</span>
                </span>
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--text-muted)',
                    transform: userMenuOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--transition-fast)',
                  }}
                />
              </button>

              {userMenuOpen && (
                <div className="dropdown-menu" role="menu">
                  <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{displayName}</div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                      {t(`user.${user?.role}`)}
                    </div>
                  </div>
                  <div className="dropdown-separator" />
                  <button className="dropdown-item danger" role="menuitem" onClick={handleLogout}>
                    <LogOut size={16} /> {t('auth.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
