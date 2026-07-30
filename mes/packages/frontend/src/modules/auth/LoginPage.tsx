import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { useAuth } from '../../core/hooks/useAuth';
import { useTheme } from '../../core/hooks/useTheme';
import { useLanguage } from '../../core/hooks/useLanguage';
import { useAppStore } from '../../core/store/appStore';
import { ApiError } from '../../core/services/api';
import { Alert, Button, Input } from '../../core/components/common';
import { Moon, Sun, Languages } from 'lucide-react';

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

  // Oturum geri yüklenirken bekle
  if (isLoading) {
    return (
      <div className="login-page">
        <span className="text-muted">{t('common.loading')}</span>
      </div>
    );
  }

  // Zaten giriş yapılmış — login sayfasında kalma
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
      <div style={{ position: 'absolute', top: 'var(--space-4)', right: 'var(--space-4)' }} className="flex gap-2">
        <button
          className="btn-icon"
          onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
          title={t(`language.${language === 'tr' ? 'en' : 'tr'}`)}
        >
          <Languages size={18} />
        </button>
        <button
          className="btn-icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={t(`theme.${theme === 'dark' ? 'light' : 'dark'}`)}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-mark">
            <Factory size={26} />
          </div>
          <h1>{companyName} MES</h1>
          <p>{t('auth.loginSubtitle')}</p>
        </div>


        <div className="card">
          <h2 className="card-title">{t('auth.loginTitle')}</h2>
          <form onSubmit={handleSubmit}>
            <Input
              label={t('auth.username')}
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <Input
              label={t('auth.password')}
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error && (
              <Alert variant="danger" className="mb-4">
                {error}
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('auth.loggingIn') : t('auth.login')}
            </Button>
          </form>
        </div>

        {poweredByVisible && <div className="login-footer">{t('poweredBy')}</div>}
      </div>
    </div>
  );
}