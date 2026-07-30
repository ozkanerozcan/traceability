import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from 'lucide-react';
import { useWsMessage } from '../../hooks/useWebSocket';

/* ─── Button ─────────────────────────────────────────────────────────────── */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Kompakt boyut — tablo aksiyonları, yoğun alanlar */
  small?: boolean;
}

export function Button({ variant = 'primary', small, className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}${small ? ' btn-sm' : ''} ${className}`.trim()}
      {...rest}
    />
  );
}

/* ─── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, id, ...rest }: InputProps) {
  const inputId = id ?? rest.name;
  return (
    <div className="form-group">
      {label && (
        <label className="form-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className="input" {...rest} />
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

/* ─── Select ─────────────────────────────────────────────────────────────── */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, error, id, children, ...rest }: SelectProps) {
  const selectId = id ?? rest.name;
  return (
    <div className="form-group">
      {label && (
        <label className="form-label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select id={selectId} className="select" {...rest}>
        {children}
      </select>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

/* ─── Card ───────────────────────────────────────────────────────────────── */

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="card-title" style={{ marginBottom: 0 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/* ─── Modal ──────────────────────────────────────────────────────────────── */

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Geniş içerikler (tablo, ağaç) için 820px genişlik */
  wide?: boolean;
  /**
   * Başka bir modal açıkken üzerine açılan ikincil diyaloglar için
   * (browse, picker deseni): z-index bir basamak yükseltilir.
   */
  modalStack?: boolean;
}

/**
 * Açık modal yığını — Escape yalnızca EN ÜSTTEKİ modalı kapatır.
 * (İç içe pop-up deseninde alttaki diyalog açık kalır.)
 */
const modalCloseStack: Array<() => void> = [];
let escapeListenerAttached = false;

function handleGlobalEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const topmost = modalCloseStack[modalCloseStack.length - 1];
  topmost?.();
}

export function Modal({ open, title, onClose, children, footer, wide, modalStack }: ModalProps) {

  // Escape ile kapat (yalnız en üstteki) + arka plan kaydırmasını kilitle
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    modalCloseStack.push(onClose);
    if (!escapeListenerAttached) {
      document.addEventListener('keydown', handleGlobalEscape);
      escapeListenerAttached = true;
    }

    return () => {
      document.body.style.overflow = prevOverflow;
      const idx = modalCloseStack.indexOf(onClose);
      if (idx !== -1) modalCloseStack.splice(idx, 1);
      if (modalCloseStack.length === 0 && escapeListenerAttached) {
        document.removeEventListener('keydown', handleGlobalEscape);
        escapeListenerAttached = false;
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal: overlay her zaman document.body'ye render edilir.
  // Böylece iç içe pop-up'larda ikincil diyalog, üst modalın
  // backdrop-filter containing block'una hapsolMAZ — tam sayfa
  // karartma + blur ile önceki modalın üzerinde açılır
  // (TagForm → NodeBrowserDialog ile aynı desen).
  return createPortal(
    <div
      className="modal-overlay"
      onClick={onClose}
      style={modalStack ? { zIndex: 'calc(var(--z-modal) + var(--z-modal-step))' } : undefined}
    >
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}

        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label={title}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ─── Confirm Dialog ─────────────────────────────────────────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  /** Onay butonu metni — varsayılan: common.delete */
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Yıkıcı işlemler için kullanıcı dostu onay diyaloğu. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel ?? t('common.delete')}
          </Button>
        </>
      }
    >
      <p style={{ lineHeight: 1.6 }}>{message}</p>
    </Modal>
  );
}

/* ─── Table ──────────────────────────────────────────────────────────────── */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="table-container">
      <table className="table">{children}</table>
    </div>
  );
}

/* ─── Badge ──────────────────────────────────────────────────────────────── */

export function Badge({
  variant = 'muted',
  children,
}: {
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
  children: ReactNode;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

/* ─── Alert (bilgi/hata şeridi) ──────────────────────────────────────────── */

const ALERT_ICONS: Record<string, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  warning: <AlertTriangle size={16} />,
  danger: <XCircle size={16} />,
  info: <Info size={16} />,
};

/** Form/sayfa içi durum mesajları için tutarlı, yumuşak hatlı şerit. */
export function Alert({
  variant = 'info',
  children,
  className = '',
}: {
  variant?: 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`alert alert-${variant} ${className}`.trim()} role="status">
      <span className="alert-icon">{ALERT_ICONS[variant]}</span>
      <div className="alert-body">{children}</div>
    </div>
  );
}

/* ─── Checkbox ───────────────────────────────────────────────────────────── */

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

/** Yumuşak hatlı, tema uyumlu onay kutusu (etiketli). */
export function Checkbox({ label, id, className = '', ...rest }: CheckboxProps) {
  const inputId = id ?? rest.name;
  return (
    <label className={`checkbox ${className}`.trim()} htmlFor={inputId}>
      <input id={inputId} type="checkbox" className="checkbox-input" {...rest} />
      <span className="checkbox-box" aria-hidden="true" />
      {label != null && <span className="checkbox-label">{label}</span>}
    </label>
  );
}

/* ─── Toast (Bildirim) Sistemi ───────────────────────────────────────────── */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  /** ms cinsinden; 0 = kalıcı */
  duration: number;
  leaving?: boolean;
}

interface ToastOptions {
  title?: string;
  /** ms cinsinden kalış süresi (varsayılan 4200, 0 = kalıcı) */
  duration?: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

const TOAST_EXIT_MS = 150;
let nextToastId = 1;

/** Backend `system:notification` mesajının severity eşlemesi */
const SEVERITY_MAP: Record<string, ToastType> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    // Önce çıkış animasyonu, sonra DOM'dan kaldır
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }, TOAST_EXIT_MS);
  }, []);

  const toast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = nextToastId++;
      const duration = options?.duration ?? 4200;
      setToasts((prev) => [
        // Aynı anda en fazla 4 toast — yenisi eskiyi iter
        ...prev.slice(-3),
        { id, type, message, title: options?.title, duration },
      ]);
      if (duration > 0) {
        timersRef.current.set(id, setTimeout(() => dismiss(id), duration));
      }
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    toast,
    success: useCallback((m: string, o?: ToastOptions) => toast('success', m, o), [toast]),
    error: useCallback((m: string, o?: ToastOptions) => toast('error', m, o), [toast]),
    warning: useCallback((m: string, o?: ToastOptions) => toast('warning', m, o), [toast]),
    info: useCallback((m: string, o?: ToastOptions) => toast('info', m, o), [toast]),
  };

  // Backend'den gelen sistem bildirimleri otomatik toast'a dönüşür
  useWsMessage<{ message: string; severity: 'info' | 'warning' | 'error' }>(
    'system:notification',
    useCallback(
      (payload) => {
        if (!payload?.message) return;
        toast(SEVERITY_MAP[payload.severity] ?? 'info', payload.message);
      },
      [toast]
    )
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" role="region" aria-live="polite" aria-label="Bildirimler">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.type}${item.leaving ? ' leaving' : ''}`}
            role={item.type === 'error' ? 'alert' : 'status'}
          >
            <span className="toast-icon">{TOAST_ICONS[item.type]}</span>
            <div className="toast-body">
              {item.title && <div className="toast-title">{item.title}</div>}
              <div className="toast-message">{item.message}</div>
            </div>
            <button
              className="btn-icon"
              style={{ minWidth: 28, minHeight: 28, padding: 4, marginTop: -2 }}
              onClick={() => dismiss(item.id)}
              aria-label="Kapat"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Bildirim göstermek için: const toast = useToast(); toast.success('Kaydedildi'); */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast, ToastProvider içinde kullanılmalıdır');
  }
  return ctx;
}
