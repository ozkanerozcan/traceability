import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { Alert, Button, Card, Checkbox, Input, useToast } from '../../../core/components/common';
import { moduleService, settingsService, type ModuleEntry } from '../services/admin.service';
import ArchivePanel from './ArchivePanel';
import '../styles/settings.css';

export default function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [companyName, setCompanyName] = useState('');
  const [poweredByVisible, setPoweredByVisible] = useState(true);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moduleBusy, setModuleBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ settings }, { modules: mods }] = await Promise.all([
        settingsService.list(),
        moduleService.list(),
      ]);
      const map = new Map(settings.map((s) => [s.key, s.value]));
      setCompanyName(map.get('company_name') ?? 'OE');
      setPoweredByVisible((map.get('powered_by_visible') ?? 'true') === 'true');
      setModules(mods);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveBranding = async () => {
    setSaving(true);
    try {
      await settingsService.update({
        company_name: companyName.trim() || 'OE',
        powered_by_visible: String(poweredByVisible),
      });
      toast.success(t('common.success'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = async (mod: ModuleEntry, enabled: boolean) => {
    setModuleBusy(mod.id);
    try {
      const res = await moduleService.setEnabled(mod.id, enabled);
      setModules((prev) => prev.map((m) => (m.id === mod.id ? { ...m, enabled } : m)));
      if (res.restartRequired) {
        toast.warning(t('settings.restartRequired'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setModuleBusy(null);
    }
  };

  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: 'var(--font-size-2xl)', marginBottom: 'var(--space-5)' }}>
        {t('nav.settings')}
      </h1>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <div className="settings-grid">
        {/* ─── Branding ─── */}
        <Card title={t('settings.branding')}>
          <Input
            label={t('settings.companyName')}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <Checkbox
            label={t('settings.showPoweredBy')}
            checked={poweredByVisible}
            onChange={(e) => setPoweredByVisible(e.target.checked)}
          />
          <Button onClick={handleSaveBranding} disabled={saving}>
            <Save size={16} /> {saving ? t('common.loading') : t('common.save')}
          </Button>
        </Card>

        {/* ─── Modül Yönetimi ─── */}
        <Card title={t('settings.modules')}>
          <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
            {t('settings.modulesHint')}
          </p>
          {modules.map((mod) => (
            <Checkbox
              key={mod.id}
              label={mod.name}
              checked={mod.enabled}
              disabled={moduleBusy === mod.id}
              onChange={(e) => toggleModule(mod, e.target.checked)}
            />
          ))}
        </Card>

        {/* ─── Arşivleme ─── */}
        <ArchivePanel />
      </div>
    </div>
  );
}
