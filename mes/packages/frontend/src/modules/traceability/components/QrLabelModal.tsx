import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { Button, Modal } from '../../../core/components/common';
import QrCode from './QrCode';

export interface QrLabelData {
  productId: string;
  svgPath: string;
  size: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  label: QrLabelData | null;
  /** Etiket genişliği (mm) — istasyon config'inden */
  labelWidthMm?: number;
  /** Etiket yüksekliği (mm) — istasyon config'inden */
  labelHeightMm?: number;
}

const DEFAULT_W = 50;
const DEFAULT_H = 30;

/**
 * QR etiket önizleme + yazdırma pop-up'ı.
 * Etiket, istasyon oluşturulurken ayarlanan gerçek mm boyutunda render edilir;
 * yazdırmada sayfa boyutu etiket boyutuna eşitlenir (@page).
 */
export default function QrLabelModal({ open, onClose, label, labelWidthMm, labelHeightMm }: Props) {
  const { t } = useTranslation();
  const w = labelWidthMm && labelWidthMm > 0 ? labelWidthMm : DEFAULT_W;
  const h = labelHeightMm && labelHeightMm > 0 ? labelHeightMm : DEFAULT_H;

  // QR boyutu: etiket içine sığacak kare — kenar boşluğu + alttaki metin için yer bırak
  const padMm = 2;
  const textMm = 6;
  const qrMm = Math.max(8, Math.min(w - padMm * 2, h - padMm * 2 - textMm));

  // Yazdırmada sayfa boyutunu etiket boyutuna eşitle (dinamik @page)
  useEffect(() => {
    if (!open) return;
    const style = document.createElement('style');
    style.setAttribute('data-qr-print', 'true');
    style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [open, w, h]);

  if (!label) return null;

  const handlePrint = () => window.print();

  return (
    <Modal
      open={open}
      title={t('trace.qrLabel')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={handlePrint}>
            <Printer size={16} /> {t('trace.print')}
          </Button>
        </>
      }
    >
      <div className="trace-qr-preview-wrap">
        <div className="trace-qr-print trace-qr-print-modal-target" style={{ width: `${w}mm`, height: `${h}mm` }}>
          <QrCode svgPath={label.svgPath} size={label.size} sizeMm={qrMm} />
          <div className="trace-qr-print-text">{label.productId}</div>
        </div>
      </div>
      <p className="text-muted trace-qr-preview-dim">
        {w} × {h} mm
      </p>
    </Modal>
  );
}
