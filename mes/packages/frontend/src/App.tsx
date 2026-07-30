import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ThemeProvider from './core/components/ThemeProvider/ThemeProvider';
import LanguageProvider from './core/components/LanguageProvider/LanguageProvider';
import ProtectedRoute from './core/components/ProtectedRoute/ProtectedRoute';
import Layout from './core/components/Layout/Layout';
import ErrorBoundary from './core/components/ErrorBoundary/ErrorBoundary';
import { ToastProvider } from './core/components/common';
import LoginPage from './modules/auth/LoginPage';
import { useAuthRestore } from './core/hooks/useAuth';
import { Loader2 } from 'lucide-react';

// Modül sayfaları lazy load — Faz 4-6'da diğer modüller eklenecek
const DashboardPage = lazy(() => import('./modules/dashboard/DashboardPage'));
const PlcListPage = lazy(() => import('./modules/plc-gateway/components/PlcList'));
const TagListPage = lazy(() => import('./modules/plc-gateway/components/TagList'));
const LiveMonitorPage = lazy(() => import('./modules/plc-gateway/components/LiveMonitor'));
const ReadWritePage = lazy(() => import('./modules/plc-gateway/components/ReadWritePanel'));
const RecipeListPage = lazy(() => import('./modules/recipe/components/RecipeList'));
const DashboardEditorPage = lazy(() => import('./modules/recipe/components/DashboardEditor'));
const WorkOrderListPage = lazy(() => import('./modules/work-order/components/WorkOrderList'));
const UserListPage = lazy(() => import('./modules/user-management/components/UserList'));
const SettingsPage = lazy(() => import('./modules/system-settings/components/SettingsPage'));
const AuditLogPage = lazy(() => import('./modules/system-settings/components/AuditLogViewer'));
const TraceStationsPage = lazy(() => import('./modules/traceability/components/StationsPage'));
const TraceStationWorkPage = lazy(() => import('./modules/traceability/components/StationWorkPage'));
const TraceProductsPage = lazy(() => import('./modules/traceability/components/ProductsPage'));
const TraceTrolleysPage = lazy(() => import('./modules/traceability/components/TrolleysPage'));
const TraceRoutesPage = lazy(() => import('./modules/traceability/components/RoutesPage'));
const TraceAlarmsPage = lazy(() => import('./modules/traceability/components/AlarmsPanel'));

function PageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: 'var(--space-3)',
        color: 'var(--accent)',
      }}
    >
      <Loader2 size={32} className="spin" />
      <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
        Modül Yükleniyor...
      </span>
    </div>
  );
}

export default function App() {
  // Oturum geri yükleme — route'lardan ÖNCE çalışmalı (yükleniyor ekranında
  // takılmayı önler)
  useAuthRestore();

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <ToastProvider>
            <BrowserRouter>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />

                  {/* Korumalı alan */}
                  <Route element={<ProtectedRoute />}>
                    <Route element={<Layout />}>
                      <Route index element={<DashboardPage />} />
                      <Route path="dashboard/:workOrderId" element={<DashboardPage />} />
                      <Route path="plc" element={<PlcListPage />} />
                      <Route path="plc/:id/tags" element={<TagListPage />} />
                      <Route path="plc/:id/monitor" element={<LiveMonitorPage />} />
                      <Route path="plc/read-write" element={<ReadWritePage />} />
                      <Route path="recipes" element={<RecipeListPage />} />
                      <Route path="recipes/:id/dashboard" element={<DashboardEditorPage />} />
                      <Route path="work-orders" element={<WorkOrderListPage />} />
                      <Route path="users" element={<UserListPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="audit" element={<AuditLogPage />} />
                      <Route path="trace/stations" element={<TraceStationsPage />} />
                      <Route path="trace/work/:stationKey" element={<TraceStationWorkPage />} />
                      <Route path="trace/products" element={<TraceProductsPage />} />
                      <Route path="trace/trolleys" element={<TraceTrolleysPage />} />
                      <Route path="trace/routes" element={<TraceRoutesPage />} />
                      <Route path="trace/alarms" element={<TraceAlarmsPage />} />
                    </Route>
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ToastProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

