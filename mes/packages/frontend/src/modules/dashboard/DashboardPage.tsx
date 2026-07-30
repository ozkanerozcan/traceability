import { useParams } from 'react-router-dom';
import DashboardSelector from './components/DashboardSelector';
import DashboardView from './components/DashboardView';

/**
 * Dashboard: `/` → aktif/paused iş emri seçici;
 * `/dashboard/:workOrderId` → salt-görüntüleme canlı dashboard.
 */
export default function DashboardPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();

  if (workOrderId) {
    return <DashboardView workOrderId={Number(workOrderId)} />;
  }
  return <DashboardSelector />;
}
