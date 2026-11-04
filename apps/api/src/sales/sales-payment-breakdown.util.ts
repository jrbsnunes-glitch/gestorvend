import {
  CardOperation,
  PaymentMethod,
  Prisma,
  PrismaClient,
  SaleStatus,
} from '../generated/tenant-client';

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type SalePaymentLike = { method: string; amount: unknown };

export type SplitSalePaymentsResult = {
  /** Tudo exceto requisição (caixa, cartão, saldo crediário, etc.). */
  receivedAtSale: number;
  requisitionAtSale: number;
  creditFromBalance: number;
};

export function splitSalePayments(payments: SalePaymentLike[]): SplitSalePaymentsResult {
  let receivedAtSale = 0;
  let requisitionAtSale = 0;
  let creditFromBalance = 0;
  for (const p of payments) {
    const amt = Number(p.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    if (p.method === PaymentMethod.REQUISITION) {
      requisitionAtSale += amt;
    } else {
      receivedAtSale += amt;
      if (p.method === PaymentMethod.CREDIT) creditFromBalance += amt;
    }
  }
  return {
    receivedAtSale: roundMoney(receivedAtSale),
    requisitionAtSale: roundMoney(requisitionAtSale),
    creditFromBalance: roundMoney(creditFromBalance),
  };
}

export type SumReceivableViaCashOpts = {
  from: Date;
  to: Date;
  sessionId?: string;
};

/** Vendas pagas com cartão de crédito (repasse não entra no caixa no mesmo dia). */
export function cardCreditSalePaymentWhere(
  createdAt: { gte: Date; lte: Date },
): Prisma.SalePaymentWhereInput {
  return {
    method: PaymentMethod.CARD,
    OR: [
      { cardOperation: CardOperation.CREDIT },
      {
        cardOperation: null,
        paymentForm: { cardOperation: CardOperation.CREDIT },
      },
    ],
    sale: {
      status: SaleStatus.COMPLETED,
      createdAt,
    },
  };
}

export async function sumCardCreditSalesAtSale(
  db: PrismaClient,
  range: { from: Date; to: Date },
): Promise<number> {
  const agg = await db.salePayment.aggregate({
    where: cardCreditSalePaymentWhere({ gte: range.from, lte: range.to }),
    _sum: { amount: true },
  });
  return roundMoney(Number(agg._sum.amount ?? 0));
}

export async function sumReceivableSettlementsViaCash(
  db: PrismaClient,
  opts: SumReceivableViaCashOpts,
): Promise<number> {
  const where: Prisma.ReceivableSettlementWhereInput = {
    cashSessionId: { not: null },
    receivedAt: { gte: opts.from, lte: opts.to },
  };
  if (opts.sessionId?.trim()) {
    where.cashSessionId = opts.sessionId.trim();
  }
  const agg = await db.receivableSettlement.aggregate({
    where,
    _sum: { amount: true },
  });
  return roundMoney(Number(agg._sum.amount ?? 0));
}
