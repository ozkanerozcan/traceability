interface Props {
  svgPath: string;
  size: number;
  /** Modül başına piksel (varsayılan 4) */
  scale?: number;
  /**
   * Gerçek fiziksel boyut (mm). Verilirse SVG viewBox üzerinden
   * kayıpsız ölçeklenir ve etiket üzerinde tam mm boyutunda basılır.
   */
  sizeMm?: number;
  className?: string;
}

/** Backend QR SVG path'ini render eder (bağımlılıksız). */
export default function QrCode({ svgPath, size, scale = 4, sizeMm, className }: Props) {
  const quiet = 4; // sessiz bölge (modül)
  const total = (size + quiet * 2) * scale;
  const box = size + quiet * 2;
  return (
    <svg
      className={className}
      width={sizeMm !== undefined ? undefined : total}
      height={sizeMm !== undefined ? undefined : total}
      style={sizeMm !== undefined ? { width: `${sizeMm}mm`, height: `${sizeMm}mm` } : undefined}
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label="QR Code"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={svgPath} fill="#000" transform={`translate(${quiet}, ${quiet})`} />
    </svg>
  );
}
