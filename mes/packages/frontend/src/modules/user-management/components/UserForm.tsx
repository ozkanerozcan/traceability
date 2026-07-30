import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Input, Modal, Select, useToast } from '../../../core/components/common';
import { userService, type AdminUser } from '../../system-settings/services/admin.service';

interface UserFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: AdminUser | null;
}

export default function UserForm({ open, onClose, onSaved, user }: UserFormProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = !!user;

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('operator');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUsername(user?.username ?? '');
      setDisplayName(user?.displayName ?? '');
      setRole(user?.role ?? 'operator');
      setPassword('');
      setIsActive(user?.isActive ?? true);
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await userService.update(user.id, {
          role,
          displayName: displayName || null,
          isActive,
          ...(password ? { password } : {}),
        });
      } else {
        if (!username.trim() || !password) {
          setError(t('users.fillRequired'));
          setSaving(false);
          return;
        }
        await userService.create({
          username: username.trim(),
          password,
          role,
          displayName: displayName || null,
          isActive,
        });
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

  return (
    <Modal
      open={open}
      title={isEdit ? t('users.edit') : t('users.add')}
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
      {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

      <Input
        label={t('auth.username')}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        disabled={isEdit}
        required={!isEdit}
        autoComplete="off"
      />
      <Input
        label={t('user.displayName')}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <Select label={t('user.role')} value={role} onChange={(e) => setRole(e.target.value as AdminUser['role'])}>
        <option value="admin">{t('user.admin')}</option>
        <option value="supervisor">{t('user.supervisor')}</option>
        <option value="operator">{t('user.operator')}</option>
      </Select>
      <Input
        label={isEdit ? t('users.newPassword') : t('auth.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={isEdit ? t('plc.passwordKeep') : ''}
        required={!isEdit}
        autoComplete="new-password"
      />
      <Checkbox
        label={t('common.active')}
        checked={isActive}
        onChange={(e) => setIsActive(e.target.checked)}
      />
    </Modal>
  );
}
