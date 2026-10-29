import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';

/** Aceita dígitos com vírgula ou ponto; vazio / incompleto retorna null. */
export function parseUserNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function allowedKeystroke(raw: string, integer: boolean): boolean {
  if (raw === '' || raw === '-') return true;
  if (integer) return /^-?\d*$/.test(raw);
  return /^-?\d*[.,]?\d*$/.test(raw);
}

function toDisplay(value: string | number): string {
  if (value === '' || value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value).replace('.', ',');
  }
  return String(value);
}

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max'
> & {
  value: string | number;
  onChange: (raw: string, parsed: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Gravado ao sair do campo se estiver vazio (ex.: quantidade padrão 1). */
  blurEmpty?: number | string;
  selectOnFocus?: boolean;
};

/**
 * Campo numérico que permite apagar o valor com backspace.
 * O valor padrão só volta ao sair do campo (blur), nunca a cada tecla.
 */
export const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput(
    {
      value,
      onChange,
      min,
      max,
      integer = false,
      blurEmpty,
      selectOnFocus = true,
      className,
      inputMode,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) {
    const [focused, setFocused] = useState(false);
    const [draft, setDraft] = useState(() => toDisplay(value));
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      if (!focused) setDraft(toDisplay(value));
    }, [value, focused]);

    function clamp(n: number): number {
      let x = n;
      if (typeof min === 'number' && x < min) x = min;
      if (typeof max === 'number' && x > max) x = max;
      if (integer) x = Math.trunc(x);
      return x;
    }

    return (
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')}
        autoComplete="off"
        className={['numeric-input', className].filter(Boolean).join(' ')}
        value={focused ? draft : toDisplay(value)}
        onFocus={(e) => {
          setFocused(true);
          setDraft(toDisplay(valueRef.current));
          onFocus?.(e);
          if (selectOnFocus) {
            requestAnimationFrame(() => e.currentTarget.select());
          }
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (!allowedKeystroke(raw, integer)) return;
          setDraft(raw);
          onChange(raw, parseUserNumber(raw));
        }}
        onBlur={(e) => {
          setFocused(false);
          let parsed = parseUserNumber(draft);
          if (parsed == null && blurEmpty != null && draft.trim() === '') {
            parsed =
              typeof blurEmpty === 'number' ? blurEmpty : parseUserNumber(String(blurEmpty));
          }
          if (parsed != null) {
            parsed = clamp(parsed);
            const raw = String(parsed).replace('.', ',');
            setDraft(raw);
            onChange(raw, parsed);
          } else {
            setDraft('');
            onChange('', null);
          }
          onBlur?.(e);
        }}
      />
    );
  },
);
