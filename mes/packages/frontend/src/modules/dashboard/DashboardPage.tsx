import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Card } from '../../core/components/common';

/**
 * Dashboard ana sayfası — Faz 5'te widget sistemi ile doldurulacak.
 * Şimdilik hoş geldin ekranı + aktif iş emri seçici placeholder'ı.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const { workOrderId } = useParams<{ workOrderId: string }>();

  return (
    <div>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--space-6)' }}>
        {t('nav.dashboard')}
      </h1>

      <Card>
        {workOrderId ? (
          <p className="text-secondary">
            İş Emri #{workOrderId} dashboard'u — Faz 5'te widget sistemi eklenecek.
          </p>
        ) : (
          <p className="text-secondary">
            Aktif iş emri bulunmuyor. İş emri yönetimi Faz 4'te, canlı dashboard
            widget'ları Faz 5'te eklenecek.
          </p>
        )}
      </Card>
    </div>
  );
}