import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FormModalBackdrop } from '../FormModalBackdrop';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import {
  paymentIntentStatusLabel,
  paymentProviderLabel,
  type PaymentIntent,
  type PaymentPspProvider,
} from '../../lib/payments';

/** QR SVG minimal via Google Chart API fallback — evita dependência extra. */
function QrImage({ value }: { value: string }) {
  const src = useMemo(
    () =>
      `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(value)}`,
    [value],
  );
  return (
    <img src={src} alt="QR Code PIX" width={220} height={220} style={{ imageRendering: 'pixelated' }} />
  );
}

export function PixQrPaymentModal({
  open,
  amount,
  provider,
  payerEmail,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  amount: number;
  provider?: PaymentPspProvider;
  payerEmail?: string;
  onClose: () => void;
  onConfirmed: (intent: PaymentIntent) => void;
}) {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [confirmedNotice, setConfirmedNotice] = useState(false);
  const startedRef = useRef(false);
  const confirmedRef = useRef(false);

  const createMut = useMutation({
    mutationFn: () =>
      api<PaymentIntent>('/payments/pix/charges', {
        method: 'POST',
        json: {
          amount,
          description: 'Venda PDV GestorVend',
          payerEmail: payerEmail || undefined,
          provider,
        },
      }),
    onSuccess: (data) => setIntentId(data.id),
  });

  useEffect(() => {
    if (!open) {
      setIntentId(null);
      setConfirmedNotice(false);
      startedRef.current = false;
      confirmedRef.current = false;
      return;
    }
    if (!startedRef.current) {
      startedRef.current = true;
      createMut.mutate();
    }
  }, [open, createMut]);

  const statusQ = useQuery({
    queryKey: ['payments', 'intent', intentId],
    queryFn: () => api<PaymentIntent>(`/payments/intents/${intentId}?refresh=1`),
    enabled: Boolean(open && intentId),
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      if (st === 'CONFIRMED' || st === 'EXPIRED' || st === 'CANCELLED' || st === 'FAILED') {
        return false;
      }
      return 4000;
    },
  });

  const intent = statusQ.data ?? createMut.data;

  useEffect(() => {
    if (intent?.status !== 'CONFIRMED' || confirmedRef.current) return;
    confirmedRef.current = true;
    setConfirmedNotice(true);
    const timer = window.setTimeout(() => onConfirmed(intent), 1800);
    return () => window.clearTimeout(timer);
  }, [intent, onConfirmed]);

  const cancelMut = useMutation({
    mutationFn: () => api(`/payments/intents/${intentId}`, { method: 'DELETE' }),
    onSuccess: onClose,
  });

  if (!open) return null;

  return (
    <FormModalBackdrop onClose={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>PIX — QR Code</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
          {formatBRL(amount)}
          {intent?.provider ? ` · ${paymentProviderLabel(intent.provider)}` : ''}
        </p>

        {createMut.isError ? (
          <p style={{ color: 'var(--color-danger)' }}>
            {createMut.error instanceof Error ? createMut.error.message : 'Erro ao gerar QR'}
          </p>
        ) : null}

        {intent?.qrCode ? (
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <QrImage value={intent.qrCode} />
            <textarea
              readOnly
              value={intent.qrCode}
              rows={3}
              style={{ width: '100%', marginTop: '0.75rem', fontSize: '0.75rem' }}
              onFocus={(e) => e.target.select()}
            />
            <p style={{ fontSize: '0.85rem' }}>Copia e cola acima</p>
          </div>
        ) : createMut.isPending ? (
          <p>Gerando cobrança… (aguarde até 30s)</p>
        ) : createMut.isSuccess && !intent?.qrCode ? (
          <p style={{ color: 'var(--color-danger)' }}>
            Cobrança criada, mas o QR não veio. Verifique chave PIX e credenciais de teste no Mercado Pago.
          </p>
        ) : null}

        {confirmedNotice ? (
          <p style={{ color: 'var(--color-success, #0a7)', fontWeight: 600 }}>
            PIX confirmado! Adicionando pagamento…
          </p>
        ) : null}

        {intent ? (
          <p>
            Status: <strong>{paymentIntentStatusLabel(intent.status)}</strong>
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!intentId || cancelMut.isPending}
            onClick={() => intentId && cancelMut.mutate()}
          >
            Cancelar cobrança
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </FormModalBackdrop>
  );
}
