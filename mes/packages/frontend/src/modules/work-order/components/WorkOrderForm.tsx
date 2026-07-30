import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Modal, Select, useToast } from '../../../core/components/common';
import { workOrderService } from '../services/workOrder.service';
import type { Recipe } from '../../recipe/services/recipe.service';

interface WorkOrderFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  recipes: Recipe[];
}

/** Yeni iş emri — reçete seçimi + opsiyonel not. Numara otomatik üretilir (WO-YYYYMMDD-NNN). */
export default function WorkOrderForm({ open, onClose, onSaved, recipes }: WorkOrderFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [recipeId, setRecipeId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRecipeId(recipes[0]?.id ?? '');
      setNotes('');
      setError(null);
    }
  }, [open, recipes]);

  const handleSubmit = async () => {
    if (!recipeId) {
      setError(t('workOrder.recipeRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await workOrderService.create({ recipeId: Number(recipeId), notes: notes.trim() || null });
      toast.success(t('common.success'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('workOrder.add')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={saving || recipes.length === 0}>
            {saving ? t('common.loading') : t('common.create')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="danger" className="mb-4">{error}</Alert>
      )}

      {recipes.length === 0 ? (
        <Alert variant="warning">{t('workOrder.noRecipesHint')}</Alert>
      ) : (
        <>
          <Select
            label={t('workOrder.recipe')}
            value={recipeId}
            onChange={(e) => setRecipeId(Number(e.target.value))}
          >
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>

          <div className="form-group">
            <label className="form-label" htmlFor="wo-notes">
              {t('workOrder.notes')}
            </label>
            <textarea
              id="wo-notes"
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
