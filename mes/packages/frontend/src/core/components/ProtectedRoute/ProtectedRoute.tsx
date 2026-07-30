import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import type { Role } from '../../store/authStore';

interface ProtectedRouteProps {
  /** Bu route'a erişebilecek roller. Boşsa tüm oturum açmış kullanıcılar erişir. */
  roles?: Role[];
}

/**
 * Yetki kontrolü: oturum yoksa /login'e, rol yetersizse ana sayfaya yönlendirir.
 * Oturum geri yüklenirken (isLoading) bekleme ekranı gösterir.
 */
export default function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        Yükleniyor...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}