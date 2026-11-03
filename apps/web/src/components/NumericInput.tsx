import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { formatBrMoney, parseBrMoney } from '../lib/format';

/** Aceita dígitos com vírgula ou ponto; vazio / incompleto retorna null. */
export function parseUserNumber(raw: string, money = false): number | null {
  if (money) return parseBrMoney(raw);
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function allowedKeystroke(raw: string, integer: boolean, money: boolean): boolean {
  if (raw === '' || raw === '-') return true;
  if (integer) return /^-?\d*$/.test(raw);
  if (money) {
    const t = raw.trim().replace(/^R\$\s?/i, '');
    if (t === '' || t === '-') return true;
    return (
      /^-?\d{0,12}([.,]\d{0,2})?$/.test(t) ||
      /^-?\d{1,3}(\.\d{3})+([,]\d{0,2})?$/.test(t)
    );
  }
  return /^-?\d*[.,]?\d*$/.test(raw);
}

function toDisplay(value: string | number, money: boolean): string {
  if (value === '' || value == null) return '';
  if (money) {
    const n = typeof value === 'number' ? value : parseBrMoney(value);
    if (n == null) return typeof value === 'string' ? value : '';
    return formatBrMoney(n);
  }
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
  /** Valor monetário no padrão Real (1.234,56, sempre 2 casas). */
  money?: boolean;
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
      money = false,
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
    const [draft, setDraft] = useState(() => toDisplay(value, money));
    const valueRef = useRef(value);
    valueRef.current = value;

    useEffect(() => {
      if (!focused) setDraft(toDisplay(value, money));
    }, [value, focused, money]);

    function clamp(n: number): number {
      let x = n;
      if (typeof min === 'number' && x < min) x = min;
      if (typeof max === 'number' && x > max) x = max;
      if (integer) x = Math.trunc(x);
      if (money) x = Math.round(x * 100) / 100;
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
        value={focused ? draft : toDisplay(value, money)}
        onFocus={(e) => {
          setFocused(true);
          setDraft(toDisplay(valueRef.current, money));
          onFocus?.(e);
          if (selectOnFocus) {
            requestAnimationFrame(() => e.currentTarget.select());
          }
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (!allowedKeystroke(raw, integer, money)) return;
          setDraft(raw);
          onChange(raw, parseUserNumber(raw, money));
        }}
        onBlur={(e) => {
          setFocused(false);
          let parsed = parseUserNumber(draft, money);
          if (parsed == null && blurEmpty != null && draft.trim() === '') {
            parsed =
              typeof blurEmpty === 'number'
                ? blurEmpty
                : parseUserNumber(String(blurEmpty), money);
          }
          if (parsed != null) {
            parsed = clamp(parsed);
            const raw = money ? formatBrMoney(parsed) : String(parsed).replace('.', ',');
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
