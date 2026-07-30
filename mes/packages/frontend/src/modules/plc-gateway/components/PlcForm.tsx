import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Input, Modal, Select, useToast } from '../../../core/components/common';

import {
  plcService,
  type PlcProfile,
  type PlcProfileInput,
  type TestResult,
} from '../services/plc.service';

interface PlcFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Düzenleme modunda mevcut profil */
  plc?: PlcProfile | null;
}

function getInitialForm(plc?: PlcProfile | null): PlcProfileInput {
  return {
    name: plc?.name ?? '',
    protocol: plc?.protocol ?? 'modbus_tcp',
    host: plc?.host ?? '192.168.1.100',
    port: plc?.port ?? 502,
    unitId: plc?.unitId ?? 1,
    serialPort: plc?.serialPort ?? 'COM1',
    baudRate: plc?.baudRate ?? 9600,
    dataBits: plc?.dataBits ?? 8,
    stopBits: plc?.stopBits ?? 1,
    parity: plc?.parity ?? 'none',
    // ─── OPC UA ───
    endpointUrl: plc?.endpointUrl ?? 'opc.tcp://192.168.1.100:4840',
    securityMode: plc?.securityMode ?? 'None',
    securityPolicy: plc?.securityPolicy ?? 'None',
    authType: plc?.authType ?? 'anonymous',
    authUsername: plc?.authUsername ?? '',
    authPassword: '', // güvenlik: mevcut şifre forma asla doldurulmaz
    sessionTimeoutMs: plc?.sessionTimeoutMs ?? 30000,
    description: plc?.description ?? '',
    isActive: plc?.isActive ?? true,
  };
}

export default function PlcForm({ open, onClose, onSaved, plc }: PlcFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!plc;


  const [form, setForm] = useState<PlcProfileInput>(() => getInitialForm(plc));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Modal her açıldığında formu güncel PLC verisiyle sıfırla
  // (bileşen unmount olmadığı için useState initializer yeterli değil)
  useEffect(() => {
    if (open) {
      setForm(getInitialForm(plc));
      setError(null);
      setTestResult(null);
    }
  }, [open, plc]);

  const set = <K extends keyof PlcProfileInput>(key: K, value: PlcProfileInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = isEdit ? await plcService.test(plc.id) : await plcService.testRaw(form);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: t('plc.testFailed') });
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await plcService.update(plc.id, form);
      } else {
        await plcService.create(form);
      }
      toast.success(t('common.success'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };


  const securityEnabled = (form.securityMode ?? 'None') !== 'None';

  return (
    <Modal
      open={open}
      title={isEdit ? t('plc.editPlc') : t('plc.addPlc')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={handleTest} disabled={testing || saving}>
            {testing ? t('plc.testing') : t('plc.testConnection')}
          </Button>
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Input
          label={t('plc.plcName')}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />

        <Select
          label={t('plc.protocol')}
          value={form.protocol}
          onChange={(e) => set('protocol', e.target.value as PlcProfileInput['protocol'])}
        >
          <option value="modbus_tcp">Modbus TCP</option>
          <option value="modbus_rtu">Modbus RTU</option>
          <option value="opcua">OPC UA</option>
        </Select>

        {form.protocol === 'modbus_tcp' && (
          <div className="flex gap-3">
            <div style={{ flex: 2 }}>
              <Input
                label={t('plc.host')}
                value={form.host ?? ''}
                onChange={(e) => set('host', e.target.value)}
                placeholder="192.168.1.100"
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label={t('plc.port')}
                type="number"
                value={form.port ?? 502}
                onChange={(e) => set('port', Number(e.target.value))}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label={t('plc.unitId')}
                type="number"
                value={form.unitId ?? 1}
                onChange={(e) => set('unitId', Number(e.target.value))}
                required
              />
            </div>
          </div>
        )}

        {form.protocol === 'modbus_rtu' && (
          <>
            <Input
              label={t('plc.serialPort')}
              value={form.serialPort ?? ''}
              onChange={(e) => set('serialPort', e.target.value)}
              placeholder="COM1 veya /dev/ttyUSB0"
              required
            />
            <div className="flex gap-3">
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.baudRate')}
                  value={form.baudRate ?? 9600}
                  onChange={(e) => set('baudRate', Number(e.target.value))}
                >
                  {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.dataBits')}
                  value={form.dataBits ?? 8}
                  onChange={(e) => set('dataBits', Number(e.target.value))}
                >
                  <option value={7}>7</option>
                  <option value={8}>8</option>
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.stopBits')}
                  value={form.stopBits ?? 1}
                  onChange={(e) => set('stopBits', Number(e.target.value))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.parity')}
                  value={form.parity ?? 'none'}
                  onChange={(e) => set('parity', e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </Select>
              </div>
            </div>
            <Input
              label={t('plc.unitId')}
              type="number"
              value={form.unitId ?? 1}
              onChange={(e) => set('unitId', Number(e.target.value))}
              required
            />
          </>
        )}

        {form.protocol === 'opcua' && (
          <>
            <Input
              label={t('plc.endpointUrl')}
              value={form.endpointUrl ?? ''}
              onChange={(e) => set('endpointUrl', e.target.value)}
              placeholder="opc.tcp://192.168.1.100:4840"
              required
            />

            <div className="flex gap-3">
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.securityMode')}
                  value={form.securityMode ?? 'None'}
                  onChange={(e) => {
                    const mode = e.target.value as PlcProfileInput['securityMode'];
                    set('securityMode', mode);
                    if (mode === 'None') set('securityPolicy', 'None');
                    else if ((form.securityPolicy ?? 'None') === 'None') {
                      set('securityPolicy', 'Basic256Sha256');
                    }
                  }}
                >
                  <option value="None">None</option>
                  <option value="Sign">Sign</option>
                  <option value="SignAndEncrypt">SignAndEncrypt</option>
                </Select>
              </div>
              <div style={{ flex: 1 }}>
                <Select
                  label={t('plc.securityPolicy')}
                  value={form.securityPolicy ?? 'None'}
                  onChange={(e) => set('securityPolicy', e.target.value as PlcProfileInput['securityPolicy'])}
                  disabled={!securityEnabled}
                >
                  <option value="None">None</option>
                  <option value="Basic128Rsa15">Basic128Rsa15</option>
                  <option value="Basic256">Basic256</option>
                  <option value="Basic256Sha256">Basic256Sha256</option>
                  <option value="Aes128_Sha256_RsaOaep">Aes128_Sha256_RsaOaep</option>
                  <option value="Aes256_Sha256_RsaPss">Aes256_Sha256_RsaPss</option>
                </Select>
              </div>
            </div>

            <Select
              label={t('plc.authType')}
              value={form.authType ?? 'anonymous'}
              onChange={(e) => set('authType', e.target.value as PlcProfileInput['authType'])}
            >
              <option value="anonymous">{t('plc.authAnonymous')}</option>
              <option value="username">{t('plc.authUsername')}</option>
            </Select>

            {form.authType === 'username' && (
              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <Input
                    label={t('plc.username')}
                    value={form.authUsername ?? ''}
                    onChange={(e) => set('authUsername', e.target.value)}
                    required
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Input
                    label={t('plc.password')}
                    type="password"
                    value={form.authPassword ?? ''}
                    onChange={(e) => set('authPassword', e.target.value)}
                    placeholder={isEdit && plc?.hasPassword ? t('plc.passwordKeep') : ''}
                    required={!isEdit || !plc?.hasPassword}
                  />
                </div>
              </div>
            )}

            {securityEnabled && (
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-4)' }}>
                {t('plc.opcuaCertHint')}
              </p>
            )}
          </>
        )}

        <Input
          label={t('common.description')}
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />

        <Checkbox
          label={t('plc.autoStartOnBoot')}
          checked={form.isActive ?? true}
          onChange={(e) => set('isActive', e.target.checked)}
        />

        {testResult && (
          <Alert
            variant={testResult.success ? 'success' : testResult.certPending ? 'warning' : 'danger'}
            className="mb-4"
          >
            {testResult.success ? t('plc.testSuccess') : `${t('plc.testFailed')}: ${testResult.message ?? ''}`}
          </Alert>
        )}

        {error && (
          <Alert variant="danger">{error}</Alert>
        )}
      </form>
    </Modal>
  );
}
