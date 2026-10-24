import { useMemo } from 'react';

/** Padrões CODE128 (larguras barra/espaço, começando em barra). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212',
  '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221',
  '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221',
  '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131',
  '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131',
  '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111',
  '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242',
  '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311',
  '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_C = 105;
const STOP = 106;

function encodeCode128C(digits: string): number[] {
  const d = digits.replace(/\D/g, '');
  if (d.length < 2 || d.length % 2 !== 0) return [];
  const codes = [START_C];
  for (let i = 0; i < d.length; i += 2) {
    codes.push(Number(d.slice(i, i + 2)));
  }
  let sum = START_C;
  for (let i = 1; i < codes.length; i++) {
    sum += codes[i]! * i;
  }
  codes.push(sum % 103);
  codes.push(STOP);
  return codes;
}

function patternToPath(codes: number[], barH: number, module: number): { d: string; width: number } {
  let x = 0;
  const parts: string[] = [];
  for (const code of codes) {
    const pat = PATTERNS[code];
    if (!pat) continue;
    let bar = true;
    for (const ch of pat) {
      const w = Number(ch) * module;
      if (bar) parts.push(`M${x} 0h${w}v${barH}h${-w}z`);
      x += w;
      bar = !bar;
    }
  }
  return { d: parts.join(''), width: x };
}

export function Code128Barcode({
  value,
  height = 36,
  module = 1.05,
  className,
}: {
  value: string;
  height?: number;
  module?: number;
  className?: string;
}) {
  const svg = useMemo(() => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 44) return null;
    const padded = digits.length % 2 === 0 ? digits : `0${digits}`;
    const codes = encodeCode128C(padded);
    if (!codes.length) return null;
    return patternToPath(codes, height, module);
  }, [value, height, module]);

  if (!svg) return null;
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width={svg.width}
      height={height}
      viewBox={`0 0 ${svg.width} ${height}`}
      role="img"
      aria-label="Código de barras da chave de acesso"
    >
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
