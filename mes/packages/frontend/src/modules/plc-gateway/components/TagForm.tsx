import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, Select, useToast } from '../../../core/components/common';

import {
  tagService,
  type PlcProtocol,
  type PlcTag,
  type RegisterType,
  type TagDataType,
  type TagInput,
} from '../services/plc.service';
import NodeBrowserDialog from './NodeBrowserDialog';

interface TagFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  plcId: number;
  /** Tag'in ait olduğu PLC'nin protokolü — form alanları buna göre şekillenir */
  protocol: PlcProtocol;
  tag?: PlcTag | null;
}

const REGISTER_TYPES: { value: RegisterType; hint: string }[] = [
  { value: 'holding', hint: '4xxxx (okunabilir/yazılabilir)' },
  { value: 'input', hint: '3xxxx (salt okunur)' },
  { value: 'coil', hint: '0xxxx (okunabilir/yazılabilir bit)' },
  { value: 'discrete', hint: '1xxxx (salt okunur bit)' },
];

const MODBUS_DATA_TYPES: TagDataType[] = ['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'FLOAT64'];
const OPCUA_DATA_TYPES: TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];

function getInitialForm(protocol: PlcProtocol, tag?: PlcTag | null): TagInput {
  const isOpcUa = protocol === 'opcua';
  return {
    name: tag?.name ?? '',
    address: tag?.address ?? (isOpcUa ? 'ns=2;s=' : 40001),
    registerType: tag?.registerType ?? 'holding',
    dataType: tag?.dataType ?? (isOpcUa ? 'FLOAT32' : 'INT16'),
    acquisitionMode: tag?.acquisitionMode ?? (isOpcUa ? 'subscribe' : 'poll'),
    pollingIntervalMs: tag?.pollingIntervalMs ?? 1000,
    unit: tag?.unit ?? '',
    description: tag?.description ?? '',
    wordSwap: tag?.wordSwap ?? false,
    byteSwap: tag?.byteSwap ?? false,
    isActive: tag?.isActive ?? true,
  };
}

export default function TagForm({ open, onClose, onSaved, plcId, protocol, tag }: TagFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!tag;

  const isOpcUa = protocol === 'opcua';

  const [form, setForm] = useState<TagInput>(() => getInitialForm(protocol, tag));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  // Modal her açıldığında formu güncel tag verisiyle sıfırla
  useEffect(() => {
    if (open) {
      setForm(getInitialForm(protocol, tag));
      setError(null);
      setBrowseOpen(false);
    }
  }, [open, tag, protocol]);

  const set = <K extends keyof TagInput>(key: K, value: TagInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await tagService.update(tag.id, form);
      } else {
        await tagService.create(plcId, form);
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


  const isBitType = form.registerType === 'coil' || form.registerType === 'discrete';
  const dataTypes = isOpcUa ? OPCUA_DATA_TYPES : MODBUS_DATA_TYPES;

  return (
    <>
      <Modal
        open={open}
        title={isEdit ? t('plc.editTag') : t('plc.addTag')}
        onClose={onClose}
        footer={
          <>
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
            label={t('plc.tagName')}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="örn. Sicaklik_1"
            required
          />

          {isOpcUa ? (
            <>
              <div className="flex gap-3" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <Input
                    label={t('plc.nodeId')}
                    value={String(form.address)}
                    onChange={(e) => set('address', e.target.value)}
                    placeholder="ns=2;s=Kanal.Cihaz.Tag"
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setBrowseOpen(true)}
                  style={{ marginBottom: 'var(--space-4)' }}
                >
                  <Search size={16} /> {t('plc.browse')}
                </Button>
              </div>
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: '-8px', marginBottom: 'var(--space-4)' }}>
                {t('plc.nodeIdHint')}
              </p>

              <Select
                label={t('plc.acquisitionMode')}
                value={form.acquisitionMode ?? 'subscribe'}
                onChange={(e) => set('acquisitionMode', e.target.value as TagInput['acquisitionMode'])}
              >
                <option value="subscribe">{t('plc.acqSubscribe')}</option>
                <option value="poll">{t('plc.acqPoll')}</option>
              </Select>
            </>
          ) : (
            <>
              <div className="flex gap-3">
                <div style={{ flex: 1 }}>
                  <Select
                    label={t('plc.registerType')}
                    value={form.registerType}
                    onChange={(e) => {
                      const rt = e.target.value as RegisterType;
                      set('registerType', rt);
                      if (rt === 'coil' || rt === 'discrete') set('dataType', 'BOOL');
                      // Adres önerisi
                      const defaults: Record<RegisterType, number> = { holding: 40001, input: 30001, coil: 1, discrete: 10001 };
                      set('address', defaults[rt]);
                    }}
                  >
                    {REGISTER_TYPES.map((rt) => (
                      <option key={rt.value} value={rt.value}>
                        {rt.value} — {rt.hint}
                      </option>
                    ))}
                  </Select>
                </div>
                <div style={{ flex: 1 }}>
                  <Input
                    label={t('plc.address')}
                    type="number"
                    value={Number(form.address)}
                    onChange={(e) => set('address', Number(e.target.value))}
                    required
                  />
                </div>
              </div>
              <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: '-8px', marginBottom: 'var(--space-4)' }}>
                {t('plc.addressHint')}
              </p>
            </>
          )}

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Select
                label={t('plc.dataType')}
                value={form.dataType}
                onChange={(e) => set('dataType', e.target.value as TagDataType)}
                disabled={!isOpcUa && isBitType}
              >
                {dataTypes.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label={t('plc.pollingInterval')}
                type="number"
                min={100}
                step={100}
                value={form.pollingIntervalMs}
                onChange={(e) => set('pollingIntervalMs', Number(e.target.value))}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label={t('plc.unit')}
                value={form.unit ?? ''}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="°C, bar, adet..."
              />
            </div>
          </div>

          <Input
            label={t('common.description')}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />

          {!isOpcUa && !isBitType && form.dataType !== 'INT16' && form.dataType !== 'UINT16' && (
            <div className="flex gap-4">
              <Checkbox
                label="Word Swap"
                checked={form.wordSwap ?? false}
                onChange={(e) => set('wordSwap', e.target.checked)}
              />
              <Checkbox
                label="Byte Swap"
                checked={form.byteSwap ?? false}
                onChange={(e) => set('byteSwap', e.target.checked)}
              />
            </div>
          )}

          <Checkbox
            label={t('common.active')}
            checked={form.isActive ?? true}
            onChange={(e) => set('isActive', e.target.checked)}
          />

          {error && (
            <Alert variant="danger">{error}</Alert>
          )}
        </form>
      </Modal>

      {isOpcUa && (
        <NodeBrowserDialog
          open={browseOpen}
          onClose={() => setBrowseOpen(false)}
          plcId={plcId}
          onSelect={(node) => {
            set('address', node.nodeId);
            if (node.dataType) set('dataType', node.dataType);
            setBrowseOpen(false);
          }}
        />
      )}
    </>
  );
}
