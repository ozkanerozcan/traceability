import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, LayoutDashboard, Lock } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Table, useToast } from '../../../core/components/common';

import { recipeService, type Recipe } from '../services/recipe.service';
import RecipeForm from './RecipeForm';

export default function RecipeList() {
  const { t } = useTranslation();
  const toast = useToast();
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await recipeService.list();
      setRecipes(data.recipes);
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setError(null);
    try {
      await recipeService.remove(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  };


  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('nav.recipes')}</h1>
        <Button onClick={() => { setEditingRecipe(null); setFormOpen(true); }}>
          <Plus size={16} /> {t('recipe.addRecipe')}
        </Button>
      </div>

      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : recipes.length === 0 ? (
        <p className="text-muted">{t('recipe.noRecipes')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('recipe.widgetCount')}</th>
              <th>{t('recipe.workOrders')}</th>
              <th>{t('common.updatedAt')}</th>
              <th style={{ width: 180 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((recipe) => (
              <tr key={recipe.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {recipe.name}
                    {recipe.activeWorkOrders > 0 && (
                      <Lock size={13} style={{ marginLeft: 6, verticalAlign: 'middle' }} />
                    )}
                  </div>
                  {recipe.description && (
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                      {recipe.description}
                    </div>
                  )}
                </td>
                <td>
                  <Badge variant={(recipe.dashboardLayout?.widgets?.length ?? 0) > 0 ? 'info' : 'muted'}>
                    {recipe.dashboardLayout?.widgets?.length ?? 0}
                  </Badge>
                </td>
                <td>
                  {recipe.activeWorkOrders > 0 ? (
                    <Badge variant="warning">
                      {t('recipe.activeCount', { count: recipe.activeWorkOrders })}
                    </Badge>
                  ) : (
                    <span className="text-muted">{recipe.totalWorkOrders}</span>
                  )}
                </td>
                <td className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                  {new Date(recipe.updatedAt + 'Z').toLocaleString()}
                </td>
                <td>
                  <div className="flex gap-1">
                    <Link
                      to={`/recipes/${recipe.id}/dashboard`}
                      className="btn-icon"
                      title={t('recipe.editDashboard')}
                    >
                      <LayoutDashboard size={16} />
                    </Link>
                    <button
                      className="btn-icon"
                      title={t('common.edit')}
                      onClick={() => { setEditingRecipe(recipe); setFormOpen(true); }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="btn-icon"
                      title={t('common.delete')}
                      onClick={() => setDeleteTarget(recipe)}
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

      <RecipeForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        recipe={editingRecipe}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('recipe.deleteRecipe')}
        message={t('recipe.deleteConfirm', { name: deleteTarget?.name })}
        busy={busyId !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

    </div>
  );
}
