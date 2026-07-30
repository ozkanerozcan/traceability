import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, ConfirmDialog, Table, useToast } from '../../../core/components/common';
import { userService, type AdminUser } from '../../system-settings/services/admin.service';
import UserForm from './UserForm';
import PermissionEditor from './PermissionEditor';
import { useAuth } from '../../../core/hooks/useAuth';

export default function UserList() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await userService.list();
      setUsers(data.users);
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
    try {
      await userService.remove(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(t('common.success'));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--font-size-2xl)' }}>{t('nav.users')}</h1>
        <Button onClick={() => { setEditingUser(null); setFormOpen(true); }}>
          <Plus size={16} /> {t('users.add')}
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      {loading ? (
        <p className="text-muted">{t('common.loading')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('auth.username')}</th>
              <th>{t('user.displayName')}</th>
              <th>{t('user.role')}</th>
              <th>{t('common.status')}</th>
              <th style={{ width: 120 }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {u.username}
                    {u.id === me?.id && (
                      <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}> ({t('users.you')})</span>
                    )}
                  </div>
                </td>
                <td className="text-muted">{u.displayName ?? '—'}</td>
                <td>
                  <Badge variant={u.role === 'admin' ? 'warning' : u.role === 'supervisor' ? 'info' : 'muted'}>
                    {t(`user.${u.role}`)}
                  </Badge>
                </td>
                <td>
                  {u.isActive ? (
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
                      onClick={() => { setEditingUser(u); setFormOpen(true); }}
                    >
                      <Pencil size={16} />
                    </button>
                    {u.id !== me?.id && (
                      <button
                        className="btn-icon"
                        title={t('common.delete')}
                        disabled={busyId === u.id}
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <PermissionEditor />

      <UserForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={load}
        user={editingUser}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('users.delete')}
        message={t('users.deleteConfirm', { name: deleteTarget?.username })}
        busy={busyId !== null}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
