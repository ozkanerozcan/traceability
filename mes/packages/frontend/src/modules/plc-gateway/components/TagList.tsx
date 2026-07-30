import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Table, useToast } from '../../../core/components/common';

import { plcService, tagService, type PlcProfile, type PlcTag } from '../services/plc.service';
import TagForm from './TagForm';

export default function TagList() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();

  const plcId = Number(id);

  const [plc, setPlc] = useState<PlcProfile | null>(null);
  const [tags, setTags] = useState<PlcTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<PlcTag | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlcTag | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [plcData, tagData] = await Promise.all([
        plcService.get(plcId),
        tagService.list(plcId),
      ]);
      setPlc(plcData.plc);
      setTags(tagData.tags);
    } finally {
      setLoading(false);
    }
  }, [plcId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await tagService.remove(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };


  if (loading) {
    return <p className="text-muted">{t('common.loading')}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link to="/plc" className="btn-icon" title={t('common.close')}>
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{plc?.name} — {t('plc.tags')}</h1>
            <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
              {plc?.protocol === 'modbus_tcp'
                ? `${plc?.host}:${plc?.port}`
                : plc?.protocol === 'opcua'
                  ? plc?.endpointUrl
                  : plc?.serialPort}
            </span>
          </div>
        </div>
        <Button onClick={() => { setEditingTag(null); setFormOpen(true); }}>
          <Plus size={16} /> {t('plc.addTag')}
        </Button>
      </div>

      {tags.length === 0 ? (
        <p className="text-muted">{t('plc.noTags')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('plc.address')}</th>
              <th>{plc?.protocol === 'opcua' ? t('plc.acquisitionMode') : t('plc.registerType')}</th>
              <th>{t('plc.dataType')}</th>
              <th>{t('plc.polling')}</th>
              <th>{t('plc.unit')}</th>
              <th>{t('common.status')}</th>
              <th style={{ width: 120 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{tag.name}</div>
                  {tag.description && (
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{tag.description}</div>
                  )}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{tag.address}</td>
                <td>{plc?.protocol === 'opcua' ? tag.acquisitionMode : tag.registerType}</td>
                <td>{tag.dataType}</td>
                <td>{tag.pollingIntervalMs} ms</td>
                <td>{tag.unit ?? '—'}</td>
                <td>
                  {tag.isActive ? (
                    <Badge variant="success">{t('common.active')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('common.inactive')}</Badge>
                  )}
                </td>
                <td>
                  <div className="flex gap-1">
                    <button
                      className="btn-icon"
                      title={t('common.edit')}
                      onClick={() => { setEditingTag(tag); setFormOpen(true); }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title={t('common.delete')}
                      onClick={() => setDeleteTarget(tag)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <TagForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        plcId={plcId}
        protocol={plc?.protocol ?? 'modbus_tcp'}
        tag={editingTag}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('plc.deleteTag')}
        message={t('plc.deleteTagConfirm', { name: deleteTarget?.name })}
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  );
}