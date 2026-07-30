import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Factory, Loader2, Moon, Sun, Languages, Lock, User } from 'lucide-react';
import { useAuth } from '../../core/hooks/useAuth';
import { useTheme } from '../../core/hooks/useTheme';
import { useLanguage } from '../../core/hooks/useLanguage';
import { useAppStore } from '../../core/store/appStore';
import { ApiError } from '../../core/services/api';
import { Alert, Button, Input } from '../../core/components/common';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const { companyName, poweredByVisible } = useAppStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  if (isLoading) {
    return (
      <div className="login-page">
        <Loader2 size={32} className="spin text-muted" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('auth.loginError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div style={{ position: 'absolute', top: 'var(--space-6)', right: 'var(--space-6)', zIndex: 10 }} className="flex gap-2">
        <button
          className="btn-icon"
          style={{ background: 'var(--glass)', border: '1px solid var(--border-color)' }}
          onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
          title={t(`language.${language === 'tr' ? 'en' : 'tr'}`)}
          aria-label="Dil değiştir"
        >
          <Languages size={18} />
        </button>
        <button
          className="btn-icon"
          style={{ background: 'var(--glass)', border: '1px solid var(--border-color)' }}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={t(`theme.${theme === 'dark' ? 'light' : 'dark'}`)}
          aria-label="Tema değiştir"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-mark">
            <Factory size={30} />
          </div>
          <h1>{companyName} MES</h1>
          <p>{t('auth.loginSubtitle')}</p>
        </div>

        <div className="card" style={{ boxShadow: 'var(--shadow-lg)', borderTop: '2px solid var(--accent)' }}>
          <h2 className="card-title" style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
            {t('auth.loginTitle')}
          </h2>

          <form onSubmit={handleSubmit}>
            <div style={{ position: 'relative' }}>
              <Input
                label={t('auth.username')}
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Örn. admin"
                required
              />
            </div>

            <div style={{ position: 'relative' }}>
              <Input
                label={t('auth.password')}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <Alert variant="danger" className="mb-4">
                {error}
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading} style={{ marginTop: 'var(--space-2)' }}>
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  {t('auth.loggingIn')}
                </>
              ) : (
                t('auth.login')
              )}
            </Button>
          </form>
        </div>

        {poweredByVisible && <div className="login-footer">{t('poweredBy')}</div>}
      </div>
    </div>
  );
}