import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  CreditKind,
  Prisma,
  SaleStatus,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseReportDate(raw: string, mode: 'start' | 'end'): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return mode === 'end' ? endOfDay(date) : startOfDay(date);
  }
  const date = new Date(raw);
  return mode === 'end' ? endOfDay(date) : startOfDay(date);
}

function moneyStr(n: number): string {
  return n.toFixed(2);
}

@Injectable()
export class CustomerReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async creditLimits(
    tenantSlug: string,
    customerId?: string,
    segment?: string,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.CustomerWhereInput = {};
    const cid = (customerId ?? '').trim();
    const seg = (segment ?? '').trim();
    if (cid) where.id = cid;
    if (seg) where.segment = seg;

    const customers = await db.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 5000,
    });

    const reqUsedRows = await db.accountReceivable.groupBy({
      by: ['customerId'],
      where: {
        creditKind: CreditKind.REQUISITION,
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
        ...(cid ? { customerId: cid } : {}),
      },
      _sum: { amountRemaining: true },
    });
    const usedMap = new Map(
      reqUsedRows.map((r) => [r.customerId, Number(r._sum.amountRemaining ?? 0)]),
    );

    const lines = customers.map((c) => {
      const reqLimit = Number(c.requisitionLimit);
      const reqUsed = usedMap.get(c.id) ?? 0;
      const reqAvail = Math.max(0, reqLimit - reqUsed);
      return {
        customerId: c.id,
        name: c.name,
        document: c.document,
        segment: c.segment,
        creditBalance: moneyStr(Number(c.creditLimit)),
        requisitionLimit: moneyStr(reqLimit),
        requisitionUsed: moneyStr(reqUsed),
        requisitionAvailable: moneyStr(reqAvail),
      };
    });

    return {
      title: 'Extrato de limites — crédito e requisição',
      filters: { customerId: cid || null, segment: seg || null },
      note:
        'Saldo de crédito = valor pré-pago disponível no cadastro. Requisição: limite cadastral menos títulos em aberto (OPEN/OVERDUE).',
      lines,
      totals: {
        customers: lines.length,
        creditBalance: moneyStr(lines.reduce((s, l) => s + Number(l.creditBalance), 0)),
        requisitionOpen: moneyStr(lines.reduce((s, l) => s + Number(l.requisitionUsed), 0)),
      },
    };
  }

  async delinquency(tenantSlug: string, segment?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const today = startOfDay(new Date());
    const seg = (segment ?? '').trim();

    const receivables = await db.accountReceivable.findMany({
      where: {
        customerId: { not: null },
        AND: [
          {
            OR: [{ creditKind: null }, { creditKind: CreditKind.REQUISITION }],
          },
          {
            OR: [
              { status: BillStatus.OVERDUE },
              { status: BillStatus.OPEN, dueDate: { lt: today } },
            ],
          },
          ...(seg ? [{ customer: { segment: seg } }] : []),
        ],
      },
      include: {
        customer: { select: { id: true, name: true, document: true, segment: true } },
        sale: { select: { number: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: 10000,
    });

    type Title = {
      receivableId: string;
      description: string;
      dueDate: string;
      amountRemaining: string;
      status: string;
      saleNumber: number | null;
      daysOverdue: number;
    };

    const byCustomer = new Map<
      string,
      {
        customerId: string;
        name: string;
        document: string | null;
        segment: string | null;
        titles: Title[];
      }
    >();

    for (const r of receivables) {
      if (!r.customer) continue;
      const due = startOfDay(r.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
      const title: Title = {
        receivableId: r.id,
        description: r.description,
        dueDate: r.dueDate.toISOString(),
        amountRemaining: moneyStr(Number(r.amountRemaining)),
        status: r.status,
        saleNumber: r.sale?.number ?? null,
        daysOverdue,
      };
      const cur = byCustomer.get(r.customer.id) ?? {
        customerId: r.customer.id,
        name: r.customer.name,
        document: r.customer.document,
        segment: r.customer.segment,
        titles: [],
      };
      cur.titles.push(title);
      byCustomer.set(r.customer.id, cur);
    }

    const lines = [...byCustomer.values()]
      .map((c) => {
        const totalOverdue = c.titles.reduce((s, t) => s + Number(t.amountRemaining), 0);
        const oldest = c.titles.reduce(
          (min, t) => (t.dueDate < min ? t.dueDate : min),
          c.titles[0]?.dueDate ?? '',
        );
        const maxDays = c.titles.reduce((m, t) => Math.max(m, t.daysOverdue), 0);
        return {
          ...c,
          openTitles: c.titles.length,
          totalOverdue: moneyStr(totalOverdue),
          oldestDueDate: oldest,
          maxDaysOverdue: maxDays,
        };
      })
      .sort((a, b) => Number(b.totalOverdue) - Number(a.totalOverdue) || a.name.localeCompare(b.name));

    const grandTotal = lines.reduce((s, l) => s + Number(l.totalOverdue), 0);

    return {
      title: 'Clientes com inadimplência',
      asOf: today.toISOString().slice(0, 10),
      filters: { segment: seg || null },
      note:
        'Títulos em aberto com vencimento anterior à data de referência ou status OVERDUE. ' +
        'Inclui requisições e demais contas a receber (exceto crédito pré-pago à vista).',
      lines,
      totals: {
        customers: lines.length,
        titles: receivables.length,
        totalOverdue: moneyStr(grandTotal),
      },
    };
  }

  /** Aging por cliente — saldo em aberto classificado por faixa de vencimento. */
  async receivablesAging(
    tenantSlug: string,
    customerId?: string,
    segment?: string,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const today = startOfDay(new Date());
    const cid = (customerId ?? '').trim();
    const seg = (segment ?? '').trim();

    const receivables = await db.accountReceivable.findMany({
      where: {
        status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
        AND: [
          {
            OR: [{ creditKind: null }, { creditKind: CreditKind.REQUISITION }],
          },
          ...(cid ? [{ customerId: cid }] : []),
          ...(seg ? [{ customer: { segment: seg } }] : []),
        ],
      },
      include: {
        customer: { select: { id: true, name: true, document: true, segment: true } },
      },
      orderBy: [{ dueDate: 'asc' }],
      take: 20000,
    });

    type BucketNums = {
      current: number;
      overdue1_30: number;
      overdue31_60: number;
      overdue61_90: number;
      overdue91_plus: number;
      total: number;
      openTitles: number;
    };

    const emptyBuckets = (): BucketNums => ({
      current: 0,
      overdue1_30: 0,
      overdue31_60: 0,
      overdue61_90: 0,
      overdue91_plus: 0,
      total: 0,
      openTitles: 0,
    });

    function addToBucket(b: BucketNums, daysPastDue: number, amount: number) {
      if (daysPastDue <= 0) b.current += amount;
      else if (daysPastDue <= 30) b.overdue1_30 += amount;
      else if (daysPastDue <= 60) b.overdue31_60 += amount;
      else if (daysPastDue <= 90) b.overdue61_90 += amount;
      else b.overdue91_plus += amount;
      b.total += amount;
      b.openTitles += 1;
    }

    const byCustomer = new Map<
      string,
      {
        customerId: string | null;
        name: string;
        document: string | null;
        segment: string | null;
        buckets: BucketNums;
      }
    >();

    let titleCount = 0;
    for (const r of receivables) {
      const amount = Number(r.amountRemaining);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      titleCount += 1;
      const due = startOfDay(r.dueDate);
      const daysPastDue = Math.floor((today.getTime() - due.getTime()) / 86400000);
      const key = r.customer?.id ?? '__none__';
      const cur = byCustomer.get(key) ?? {
        customerId: r.customer?.id ?? null,
        name: r.customer?.name ?? 'Sem cliente vinculado',
        document: r.customer?.document ?? null,
        segment: r.customer?.segment ?? null,
        buckets: emptyBuckets(),
      };
      addToBucket(cur.buckets, daysPastDue, amount);
      byCustomer.set(key, cur);
    }

    const sumBuckets = emptyBuckets();
    const lines = [...byCustomer.values()]
      .map((c) => {
        const b = c.buckets;
        sumBuckets.current += b.current;
        sumBuckets.overdue1_30 += b.overdue1_30;
        sumBuckets.overdue31_60 += b.overdue31_60;
        sumBuckets.overdue61_90 += b.overdue61_90;
        sumBuckets.overdue91_plus += b.overdue91_plus;
        sumBuckets.total += b.total;
        sumBuckets.openTitles += b.openTitles;
        return {
          customerId: c.customerId,
          name: c.name,
          document: c.document,
          segment: c.segment,
          openTitles: b.openTitles,
          current: moneyStr(b.current),
          overdue1_30: moneyStr(b.overdue1_30),
          overdue31_60: moneyStr(b.overdue31_60),
          overdue61_90: moneyStr(b.overdue61_90),
          overdue91_plus: moneyStr(b.overdue91_plus),
          total: moneyStr(b.total),
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total) || a.name.localeCompare(b.name));

    return {
      title: 'Aging — contas a receber',
      asOf: today.toISOString().slice(0, 10),
      filters: { customerId: cid || null, segment: seg || null },
      note:
        'Saldo em aberto (OPEN/OVERDUE) por faixa em relação ao vencimento. ' +
        'Coluna “A vencer”: vencimento na data de referência ou futuro. Demais colunas: dias de atraso. ' +
        'Exclui crédito pré-pago à vista (crediário).',
      lines,
      totals: {
        customers: lines.length,
        titles: titleCount,
        current: moneyStr(sumBuckets.current),
        overdue1_30: moneyStr(sumBuckets.overdue1_30),
        overdue31_60: moneyStr(sumBuckets.overdue31_60),
        overdue61_90: moneyStr(sumBuckets.overdue61_90),
        overdue91_plus: moneyStr(sumBuckets.overdue91_plus),
        total: moneyStr(sumBuckets.total),
      },
    };
  }

  async salesHistory(
    tenantSlug: string,
    customerId: string,
    fromRaw: string,
    toRaw: string,
  ) {
    if (!fromRaw?.trim() || !toRaw?.trim()) {
      throw new BadRequestException('Informe from e to (YYYY-MM-DD).');
    }
    const cid = customerId.trim();
    if (!cid) throw new BadRequestException('Informe o cliente (customerId).');

    const periodStart = parseReportDate(fromRaw.trim(), 'start');
    const periodEnd = parseReportDate(toRaw.trim(), 'end');
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BadRequestException('Período inválido: data final anterior à inicial.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const customer = await db.customer.findUnique({
      where: { id: cid },
      select: { id: true, name: true, document: true, segment: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const sales = await db.sale.findMany({
      where: {
        customerId: cid,
        status: SaleStatus.COMPLETED,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: {
        payments: { select: { method: true, amount: true } },
        items: {
          select: {
            quantity: true,
            totalLine: true,
            variant: {
              select: {
                sku: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const lines = sales.map((s) => ({
      saleId: s.id,
      number: s.number,
      createdAt: s.createdAt.toISOString(),
      total: moneyStr(Number(s.total)),
      discount: moneyStr(Number(s.discount ?? 0)),
      itemCount: s.items.length,
      payments: s.payments.map((p) => ({
        method: p.method,
        amount: moneyStr(Number(p.amount)),
      })),
      items: s.items.map((it) => ({
        sku: it.variant.sku,
        productName: it.variant.product.name,
        quantity: String(it.quantity),
        totalLine: moneyStr(Number(it.totalLine)),
      })),
    }));

    const totalRevenue = sales.reduce((s, x) => s + Number(x.total), 0);

    return {
      title: 'Histórico de vendas por cliente',
      period: { from: fromRaw.trim(), to: toRaw.trim() },
      customer,
      lines,
      totals: {
        sales: lines.length,
        revenue: moneyStr(totalRevenue),
      },
    };
  }
}
