import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  CreditKind,
  PaymentMethod,
  Prisma,
  SaleStatus,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type CreditKindParam = 'CREDIT' | 'REQUISITION';

export type CustomerCreditSummary = {
  customerId: string;
  customerName: string;
  creditLimit: string;
  requisitionLimit: string;
  creditUsed: string;
  requisitionUsed: string;
  creditAvailable: string;
  requisitionAvailable: string;
};

export type CreditStatementLine = {
  date: string;
  description: string;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    totalLine: string;
  }>;
  quantity: string;
  total: string;
  saleNumber: number | null;
  saleId: string | null;
  receivableId: string;
  installmentLabel: string | null;
  amountRemaining: string;
  status: string;
  /** Saldo do limite após este movimento (ordem cronológica). */
  limitAfter: string;
};

export type CreditStatement = {
  kind: CreditKindParam;
  limit: string;
  used: string;
  available: string;
  lines: CreditStatementLine[];
};

export type CreditAdjustmentRow = {
  id: string;
  kind: CreditKindParam;
  amount: string;
  balanceAfter: string;
  mode: 'ADD' | 'SET';
  userName: string;
  createdAt: string;
};

type TenantTx = Prisma.TransactionClient;

function money(n: Prisma.Decimal | number | string): Prisma.Decimal {
  return n instanceof Prisma.Decimal ? n : new Prisma.Decimal(String(n));
}

function moneyStr(n: Prisma.Decimal): string {
  return n.toFixed(2);
}

@Injectable()
export class CustomerCreditService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private parseKind(kind: string | undefined): CreditKind {
    const k = String(kind ?? '').toUpperCase();
    if (k === 'CREDIT') return CreditKind.CREDIT;
    if (k === 'REQUISITION') return CreditKind.REQUISITION;
    throw new BadRequestException('Informe kind=CREDIT ou kind=REQUISITION.');
  }

  /**
   * Uso aberto de requisição (títulos OPEN/OVERDUE).
   * Crédito pré-pago não gera Contas a Receber — o saldo fica em Customer.creditLimit.
   */
  async openUsed(
    tenantSlug: string,
    customerId: string,
    kind: CreditKind,
  ): Promise<Prisma.Decimal> {
    if (kind === CreditKind.CREDIT) return new Prisma.Decimal(0);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.accountReceivable.findMany({
      where: {
        customerId,
        creditKind: kind,
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
      },
      select: { amountRemaining: true },
    });
    return rows.reduce((s, r) => s.add(r.amountRemaining), new Prisma.Decimal(0));
  }

  async getSummary(tenantSlug: string, customerId: string): Promise<CustomerCreditSummary> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const requisitionUsed = await this.openUsed(
      tenantSlug,
      customerId,
      CreditKind.REQUISITION,
    );

    /** Saldo de crédito = valor cadastrado (só sobe via Incluir/Editar crédito). */
    const creditAvailable = money(customer.creditLimit);
    const requisitionLimit = money(customer.requisitionLimit);
    const requisitionAvailable = Prisma.Decimal.max(
      requisitionLimit.sub(requisitionUsed),
      new Prisma.Decimal(0),
    );

    return {
      customerId: customer.id,
      customerName: customer.name,
      creditLimit: moneyStr(creditAvailable),
      requisitionLimit: moneyStr(requisitionLimit),
      creditUsed: '0.00',
      requisitionUsed: moneyStr(requisitionUsed),
      creditAvailable: moneyStr(Prisma.Decimal.max(creditAvailable, new Prisma.Decimal(0))),
      requisitionAvailable: moneyStr(requisitionAvailable),
    };
  }

  async assertAvailable(
    tenantSlug: string,
    customerId: string,
    kind: CreditKind,
    amount: number | string | Prisma.Decimal,
  ): Promise<CustomerCreditSummary> {
    const summary = await this.getSummary(tenantSlug, customerId);
    const need = money(amount);
    const available =
      kind === CreditKind.CREDIT
        ? money(summary.creditAvailable)
        : money(summary.requisitionAvailable);
    const limit =
      kind === CreditKind.CREDIT ? money(summary.creditLimit) : money(summary.requisitionLimit);
    const label = kind === CreditKind.CREDIT ? 'crédito' : 'requisição';
    if (need.greaterThan(available)) {
      throw new BadRequestException(
        `Limite de ${label} insuficiente para ${summary.customerName}. ` +
          `Limite: R$ ${moneyStr(limit)}; disponível: R$ ${moneyStr(available)}; ` +
          `valor da venda: R$ ${moneyStr(need)}.`,
      );
    }
    return summary;
  }

  /** Debita o saldo de crédito pré-pago (venda à vista com crediário). */
  async consumeCreditBalance(tx: TenantTx, customerId: string, amount: number | string) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const bal = money(customer.creditLimit);
    const need = money(amount);
    if (need.lessThanOrEqualTo(0)) return;
    if (need.greaterThan(bal)) {
      throw new BadRequestException(
        `Saldo de crédito insuficiente. Disponível: R$ ${moneyStr(bal)}; ` +
          `valor: R$ ${moneyStr(need)}.`,
      );
    }
    await tx.customer.update({
      where: { id: customerId },
      data: { creditLimit: moneyStr(bal.sub(need)) },
    });
  }

  /** Devolve saldo ao cancelar venda paga com crédito. */
  async restoreCreditBalance(tx: TenantTx, customerId: string, amount: number | string) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');
    const add = money(amount);
    if (add.lessThanOrEqualTo(0)) return;
    const next = money(customer.creditLimit).add(add);
    await tx.customer.update({
      where: { id: customerId },
      data: { creditLimit: moneyStr(next) },
    });
  }

  async getStatement(
    tenantSlug: string,
    customerId: string,
    kindRaw: string,
  ): Promise<CreditStatement> {
    const kind = this.parseKind(kindRaw);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    if (kind === CreditKind.CREDIT) {
      return this.creditSaleStatement(db, customer);
    }

    const limit = money(customer.requisitionLimit);
    const used = await this.openUsed(tenantSlug, customerId, CreditKind.REQUISITION);
    const available = Prisma.Decimal.max(limit.sub(used), new Prisma.Decimal(0));

    const receivables = await db.accountReceivable.findMany({
      where: { customerId, creditKind: CreditKind.REQUISITION },
      orderBy: [{ createdAt: 'asc' }, { dueDate: 'asc' }],
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        sale: { select: { id: true, number: true } },
      },
    });

    let running = limit;
    const lines: CreditStatementLine[] = receivables.map((r) => {
      running = running.sub(r.amount);
      const items = r.items.map((it) => ({
        description: it.description,
        quantity: String(it.quantity),
        unitPrice: moneyStr(money(it.unitPrice)),
        totalLine: moneyStr(money(it.totalLine)),
      }));
      const qtySum = r.items.reduce((s, it) => s.add(it.quantity), new Prisma.Decimal(0));
      const installmentLabel =
        r.recurrenceIndex != null && r.recurrenceCount != null
          ? `${r.recurrenceIndex}/${r.recurrenceCount}`
          : null;
      return {
        date: r.createdAt.toISOString(),
        description: r.description,
        items,
        quantity: moneyStr(qtySum),
        total: moneyStr(money(r.amount)),
        saleNumber: r.sale?.number ?? null,
        saleId: r.sale?.id ?? null,
        receivableId: r.id,
        installmentLabel,
        amountRemaining: moneyStr(money(r.amountRemaining)),
        status: r.status,
        limitAfter: moneyStr(running),
      };
    });

    return {
      kind: 'REQUISITION',
      limit: moneyStr(limit),
      used: moneyStr(used),
      available: moneyStr(available),
      lines: lines.reverse(),
    };
  }

  /** Extrato de crédito: vendas à vista que debitaram o saldo (sem Contas a Receber). */
  private async creditSaleStatement(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    customer: { id: string; name: string; creditLimit: Prisma.Decimal },
  ): Promise<CreditStatement> {
    const available = Prisma.Decimal.max(money(customer.creditLimit), new Prisma.Decimal(0));

    const sales = await db.sale.findMany({
      where: {
        customerId: customer.id,
        status: SaleStatus.COMPLETED,
        payments: { some: { method: PaymentMethod.CREDIT } },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        payments: { where: { method: PaymentMethod.CREDIT } },
        items: {
          include: {
            variant: { include: { product: { select: { name: true } } } },
          },
        },
      },
    });

    type SaleRow = (typeof sales)[number];
    const rows: Array<{ id: string; date: Date; amount: Prisma.Decimal; sale: SaleRow }> = [];
    for (const sale of sales) {
      for (const p of sale.payments) {
        rows.push({
          id: p.id,
          date: p.createdAt,
          amount: money(p.amount),
          sale,
        });
      }
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    const totalUsed = rows.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0));

    let running = available;
    const limitAfterById = new Map<string, string>();
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      limitAfterById.set(row.id, moneyStr(running));
      running = running.add(row.amount);
    }

    const lines: CreditStatementLine[] = rows.map((row) => {
      const items = row.sale.items.map((it) => ({
        description: it.variant.product?.name ?? 'Item',
        quantity: String(it.quantity),
        unitPrice: moneyStr(money(it.unitPrice)),
        totalLine: moneyStr(money(it.totalLine)),
      }));
      const qtySum = row.sale.items.reduce(
        (s, it) => s.add(it.quantity),
        new Prisma.Decimal(0),
      );
      return {
        date: row.date.toISOString(),
        description: `Venda #${row.sale.number}`,
        items,
        quantity: moneyStr(qtySum),
        total: moneyStr(row.amount),
        saleNumber: row.sale.number,
        saleId: row.sale.id,
        receivableId: row.id,
        installmentLabel: null,
        amountRemaining: '0.00',
        status: 'PAID',
        limitAfter: limitAfterById.get(row.id) ?? moneyStr(available),
      };
    });

    return {
      kind: 'CREDIT',
      limit: moneyStr(available.add(totalUsed)),
      used: moneyStr(totalUsed),
      available: moneyStr(available),
      lines: lines.reverse(),
    };
  }

  async listAdjustments(
    tenantSlug: string,
    customerId: string,
    kindRaw: string,
  ): Promise<CreditAdjustmentRow[]> {
    const kind = this.parseKind(kindRaw);
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const rows = await db.customerCreditAdjustment.findMany({
      where: { customerId, kind },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return rows.map((r) => ({
      id: r.id,
      kind: kind === CreditKind.CREDIT ? 'CREDIT' : 'REQUISITION',
      amount: moneyStr(money(r.amount)),
      balanceAfter: moneyStr(money(r.balanceAfter)),
      mode: r.mode === 'SET' ? 'SET' : 'ADD',
      userName: r.userName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * ADD: soma ao saldo/limite atual.
   * SET: define o valor absoluto (editar crédito).
   */
  async applyAdjustment(
    tenantSlug: string,
    customerId: string,
    input: {
      kind: string;
      amount: number | string;
      mode: 'ADD' | 'SET';
      userId: string;
    },
  ) {
    const kind = this.parseKind(input.kind);
    const mode = input.mode === 'SET' ? 'SET' : 'ADD';
    const amount = money(input.amount);
    if (amount.lessThan(0)) {
      throw new BadRequestException('Informe um valor zero ou maior.');
    }
    if (mode === 'ADD' && amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Informe um valor maior que zero para atualizar o saldo.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new NotFoundException('Cliente não encontrado.');

      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, name: true, username: true },
      });
      const userName = user?.name?.trim() || user?.username || 'Usuário';

      const current =
        kind === CreditKind.CREDIT
          ? money(customer.creditLimit)
          : money(customer.requisitionLimit);
      const next = mode === 'ADD' ? current.add(amount) : amount;

      await tx.customer.update({
        where: { id: customerId },
        data:
          kind === CreditKind.CREDIT
            ? { creditLimit: moneyStr(next) }
            : { requisitionLimit: moneyStr(next) },
      });

      const row = await tx.customerCreditAdjustment.create({
        data: {
          customerId,
          kind,
          amount: moneyStr(amount),
          balanceAfter: moneyStr(next),
          mode,
          userId: user?.id ?? input.userId,
          userName,
        },
      });

      return {
        customer: await tx.customer.findUniqueOrThrow({ where: { id: customerId } }),
        adjustment: {
          id: row.id,
          kind: kind === CreditKind.CREDIT ? ('CREDIT' as const) : ('REQUISITION' as const),
          amount: moneyStr(amount),
          balanceAfter: moneyStr(next),
          mode: mode as 'ADD' | 'SET',
          userName,
          createdAt: row.createdAt.toISOString(),
        },
      };
    });
  }

  /** Enriquecer resultados de search com limites/disponíveis. */
  async enrichSearchRows(
    tenantSlug: string,
    rows: Array<{ id: string; name: string; document: string | null; phone: string | null }>,
  ) {
    if (!rows.length) return [];
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const ids = rows.map((r) => r.id);
    const customers = await db.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, creditLimit: true, requisitionLimit: true },
    });
    const open = await db.accountReceivable.groupBy({
      by: ['customerId', 'creditKind'],
      where: {
        customerId: { in: ids },
        creditKind: CreditKind.REQUISITION,
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
      },
      _sum: { amountRemaining: true },
    });

    const limits = new Map(customers.map((c) => [c.id, c]));
    const reqUsed = new Map<string, Prisma.Decimal>();
    for (const id of ids) reqUsed.set(id, new Prisma.Decimal(0));
    for (const g of open) {
      if (!g.customerId) continue;
      reqUsed.set(g.customerId, money(g._sum.amountRemaining ?? 0));
    }

    return rows.map((r) => {
      const lim = limits.get(r.id);
      const creditLimit = money(lim?.creditLimit ?? 0);
      const requisitionLimit = money(lim?.requisitionLimit ?? 0);
      const usedReq = reqUsed.get(r.id) ?? new Prisma.Decimal(0);
      return {
        ...r,
        creditLimit: moneyStr(creditLimit),
        requisitionLimit: moneyStr(requisitionLimit),
        creditAvailable: moneyStr(Prisma.Decimal.max(creditLimit, new Prisma.Decimal(0))),
        requisitionAvailable: moneyStr(
          Prisma.Decimal.max(requisitionLimit.sub(usedReq), new Prisma.Decimal(0)),
        ),
      };
    });
  }
}
