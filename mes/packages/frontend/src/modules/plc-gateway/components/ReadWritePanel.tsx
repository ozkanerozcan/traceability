import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import { Badge, Button, Card, Select } from '../../../core/components/common';
import {
  plcService,
  tagService,
  type PlcProfile,
  type PlcTag,
} from '../services/plc.service';
import { formatLiveValue, usePlcLiveData } from '../hooks/usePlcLiveData';

interface ReadResult {
  value: number | boolean | string | null;
  timestamp: string;
  error?: string;
}

export default function ReadWritePanel() {
  const { t } = useTranslation();
  const [plcs, setPlcs] = useState<PlcProfile[]>([]);
  const [tags, setTags] = useState<PlcTag[]>([]);
  const [selectedPlcId, setSelectedPlcId] = useState<number | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [writeValue, setWriteValue] = useState('');
  const [readResult, setReadResult] = useState<ReadResult | null>(null);
  const [writeResult, setWriteResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Canlı değerler (worker çalışıyorsa polling verisi)
  const liveValues = usePlcLiveData(selectedPlcId);

  useEffect(() => {
    void plcService.list().then((data) => {
      setPlcs(data.plcs);
      if (data.plcs.length > 0) setSelectedPlcId(data.plcs[0].id);
    });
  }, []);

  useEffect(() => {
    if (selectedPlcId === null) return;
    setSelectedTagId(null);
    void tagService.list(selectedPlcId).then((data) => {
      setTags(data.tags);
      if (data.tags.length > 0) setSelectedTagId(data.tags[0].id);
    });
  }, [selectedPlcId]);

  const selectedTag: PlcTag | undefined = tags.find((tag) => tag.id === selectedTagId);
  const selectedPlc: PlcProfile | undefined = plcs.find((p) => p.id === selectedPlcId);
  const isOpcUa = selectedPlc?.protocol === 'opcua';
  // OPC UA'da yazılabilirliğe sunucu karar verir; Modbus'ta holding/coil yazılabilir
  const isWritable = isOpcUa
    ? !!selectedTag
    : selectedTag?.registerType === 'holding' || selectedTag?.registerType === 'coil';

  const handleRead = useCallback(async () => {
    if (selectedPlcId === null || selectedTagId === null) return;
    setBusy(true);
    setReadResult(null);
    try {
      const result = await tagService.read(selectedPlcId, selectedTagId);
      setReadResult({ value: result.value, timestamp: result.timestamp });
    } catch (err) {
      setReadResult({
        value: 0,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setBusy(false);
    }
  }, [selectedPlcId, selectedTagId, t]);

  const handleWrite = useCallback(async () => {
    if (selectedPlcId === null || selectedTagId === null || !selectedTag) return;
    setBusy(true);
    setWriteResult(null);
    try {
      const value: number | boolean | string =
        selectedTag.dataType === 'BOOL'
          ? writeValue === '1' || writeValue.toLowerCase() === 'true'
          : selectedTag.dataType === 'STRING'
            ? writeValue
            : Number(writeValue);
      await tagService.write(selectedPlcId, selectedTagId, value);
      setWriteResult({ success: true });
    } catch (err) {
      setWriteResult({
        success: false,
        message: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setBusy(false);
    }
  }, [selectedPlcId, selectedTagId, selectedTag, writeValue, t]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link to="/plc" className="btn-icon">
          <ArrowLeft size={18} />
        </Link>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('plc.readWrite')}</h1>
      </div>

      <div className="flex gap-4" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Seçim paneli */}
        <div style={{ flex: '1 1 360px', minWidth: 320 }}>
          <Card title={t('plc.tagSelection')}>
            <Select
              label={t('plc.plc')}
              value={selectedPlcId ?? ''}
              onChange={(e) => setSelectedPlcId(Number(e.target.value))}
            >
              {plcs.map((plc) => (
                <option key={plc.id} value={plc.id}>
                  {plc.name} (
                  {plc.protocol === 'modbus_tcp' ? 'TCP' : plc.protocol === 'modbus_rtu' ? 'RTU' : 'OPC UA'})
                </option>
              ))}
            </Select>

            <Select
              label={t('plc.tag')}
              value={selectedTagId ?? ''}
              onChange={(e) => setSelectedTagId(Number(e.target.value))}
            >
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} [{tag.address}]
                </option>
              ))}
            </Select>

            {selectedTag && (
              <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-4)' }}>
                {isOpcUa ? selectedTag.acquisitionMode : selectedTag.registerType} / {selectedTag.dataType}
                {selectedTag.unit ? ` / ${selectedTag.unit}` : ''}
              </div>
            )}

            {/* Canlı değer */}
            {selectedTagId !== null && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <span className="form-label">{t('plc.liveValue')}</span>
                <div style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {formatLiveValue(liveValues.get(selectedTagId)?.value, selectedTag?.unit)}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Okuma paneli */}
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          <Card title={t('plc.manualRead')}>
            <Button onClick={handleRead} disabled={busy || selectedTagId === null} className="mb-4">
              <Download size={16} /> {t('plc.read')}
            </Button>
            {readResult && (
              <div>
                {readResult.error ? (
                  <Badge variant="danger">{readResult.error}</Badge>
                ) : (
                  <>
                    <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatLiveValue(readResult.value, selectedTag?.unit)}
                    </div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                      {new Date(readResult.timestamp).toLocaleTimeString()}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Yazma paneli */}
        <div style={{ flex: '1 1 320px', minWidth: 280 }}>
          <Card title={t('plc.manualWrite')}>
            {!isWritable && selectedTag ? (
              <p className="text-muted">{t('plc.writeNotAllowed')}</p>
            ) : (
              <>
                {selectedTag?.dataType === 'BOOL' ? (
                  <Select
                    label={t('plc.value')}
                    value={writeValue}
                    onChange={(e) => setWriteValue(e.target.value)}
                  >
                    <option value="1">ON (1)</option>
                    <option value="0">OFF (0)</option>
                  </Select>
                ) : selectedTag?.dataType === 'STRING' ? (
                  <div className="form-group">
                    <label className="form-label">{t('plc.value')}</label>
                    <input
                      className="input"
                      type="text"
                      value={writeValue}
                      onChange={(e) => setWriteValue(e.target.value)}
                      placeholder={t('plc.value')}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">{t('plc.value')}</label>
                    <input
                      className="input"
                      type="number"
                      value={writeValue}
                      onChange={(e) => setWriteValue(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={handleWrite}
                  disabled={busy || selectedTagId === null || writeValue === ''}
                >
                  <Upload size={16} /> {t('plc.write')}
                </Button>
                {writeResult && (
                  <div className="mt-4">
                    {writeResult.success ? (
                      <Badge variant="success">{t('plc.writeSuccess')}</Badge>
                    ) : (
                      <Badge variant="danger">{writeResult.message}</Badge>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}