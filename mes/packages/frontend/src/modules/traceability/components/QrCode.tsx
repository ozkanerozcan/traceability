interface Props {
  svgPath: string;
  size: number;
  /** Modül başına piksel (varsayılan 4) */
  scale?: number;
  className?: string;
}

/** Backend QR SVG path'ini render eder (bağımlılıksız). */
export default function QrCode({ svgPath, size, scale = 4, className }: Props) {
  const quiet = 4; // sessiz bölge (modül)
  const total = (size + quiet * 2) * scale;
  return (
    <svg
      className={className}
      width={total}
      height={total}
      viewBox={`0 0 ${size + quiet * 2} ${size + quiet * 2}`}
      role="img"
      aria-label="QR Code"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={svgPath} fill="#000" transform={`translate(${quiet}, ${quiet})`} />
    </svg>
  );
}
