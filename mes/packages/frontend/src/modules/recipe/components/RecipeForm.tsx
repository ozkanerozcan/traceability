import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Modal, useToast } from '../../../core/components/common';

import { recipeService, type Recipe } from '../services/recipe.service';

interface RecipeFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  recipe: Recipe | null;
}

export default function RecipeForm({ open, onClose, onSaved, recipe }: RecipeFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');

  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(recipe?.name ?? '');
      setDescription(recipe?.description ?? '');
      setError(null);
    }
  }, [open, recipe]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('recipe.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (recipe) {
        await recipeService.update(recipe.id, { name: name.trim(), description: description || null });
      } else {
        await recipeService.create({ name: name.trim(), description: description || null });
      }
      toast.success(t('common.success'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };


  return (
    <Modal
      open={open}
      title={recipe ? t('recipe.editRecipe') : t('recipe.addRecipe')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <Input
        label={t('recipe.recipeName')}
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="form-group">
        <label className="form-label" htmlFor="description">
          {t('common.description')}
        </label>
        <textarea
          id="description"
          className="input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  );
}
