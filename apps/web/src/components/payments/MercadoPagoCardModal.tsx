import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormModalBackdrop } from '../FormModalBackdrop';
import { api } from '../../lib/api';
import { formatBRL } from '../../lib/format';
import type { PaymentIntent } from '../../lib/payments';

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts?: { locale: string }) => {
      bricks: () => {
        create: (
          brick: string,
          container: string,
          settings: Record<string, unknown>,
        ) => Promise<{ unmount: () => void }>;
      };
    };
  }
}

function loadMercadoPagoJs(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar Mercado Pago JS'));
    document.head.appendChild(s);
  });
}

export function MercadoPagoCardModal({
  open,
  amount,
  publicKey,
  payerEmail,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  amount: number;
  publicKey: string;
  payerEmail?: string;
  onClose: () => void;
  onConfirmed: (intent: PaymentIntent) => void;
}) {
  const brickRef = useRef<{ unmount: () => void } | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chargeMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<PaymentIntent>('/payments/card/charges', { method: 'POST', json: body }),
  });

  useEffect(() => {
    if (!open) {
      brickRef.current?.unmount();
      brickRef.current = null;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        await loadMercadoPagoJs();
        if (cancelled || !window.MercadoPago) return;
        brickRef.current?.unmount();
        const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
        const bricks = mp.bricks();
        brickRef.current = await bricks.create('cardPayment', 'mp-card-brick-container', {
          initialization: { amount },
          callbacks: {
            onReady: () => {
              if (!cancelled) setLoading(false);
            },
            onError: () => {
              if (!cancelled) setError('Erro no formulário de cartão.');
            },
            onSubmit: (formData: Record<string, unknown>, additionalData: Record<string, unknown>) =>
              new Promise<void>((resolve, reject) => {
                chargeMut.mutate(
                  {
                    amount,
                    payerEmail: payerEmail || String(formData.payer_email ?? 'cliente@gv.local'),
                    cardToken: formData.token,
                    paymentMethodId: formData.payment_method_id,
                    paymentMethodType: additionalData.paymentTypeId ?? 'credit_card',
                    installments: formData.installments ?? 1,
                    provider: 'MERCADO_PAGO',
                  },
                  {
                    onSuccess: (intent) => {
                      onConfirmedRef.current(intent);
                      resolve();
                    },
                    onError: (e) => reject(e),
                  },
                );
              }),
          },
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao iniciar cartão');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      brickRef.current?.unmount();
      brickRef.current = null;
    };
  }, [open, amount, publicKey, payerEmail, chargeMut]);

  if (!open) return null;

  return (
    <FormModalBackdrop onClose={onClose}>
      <div className="modal" role="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h2 style={{ marginTop: 0 }}>Cartão — Mercado Pago</h2>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>{formatBRL(amount)}</p>
        {loading ? <p>Carregando formulário…</p> : null}
        {error ? <p style={{ color: 'var(--color-danger)' }}>{error}</p> : null}
        <div id="mp-card-brick-container" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={chargeMut.isPending}>
            Cancelar
          </button>
        </div>
      </div>
    </FormModalBackdrop>
  );
}
