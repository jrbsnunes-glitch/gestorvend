import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLogAction,
  BillStatus,
  CashSessionStatus,
  PaymentMethod,
  Prisma,
  SaleSource,
  SaleStatus,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';

export type RequisitionItemInput = {
  variantId: string;
  quantity: number | string;
  unitPrice: number | string;
};

export type CreateRequisitionInput = {
  customerId: string;
  /** Caixa aberto que responde pelo lançamento. */
  cashSessionId: string;
  installments?: number;
  /** Primeiro vencimento (YYYY-MM-DD). Obrigatório na inclusão manual. */
  dueDate: string;
  notes?: string | null;
  items: RequisitionItemInput[];
};

export type UpdateRequisitionInput = {
  notes?: string | null;
  receivables?: Array<{ id: string; dueDate: string }>;
};

type ActingUser = { sub: string; roles: string[] };

const MAX_INSTALLMENTS = 48;

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDayStart(raw: string): Date | null {
  const s = String(raw).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    date.setHours(0, 0, 0, 0);
    return date;
  }
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

function billStatusFromDue(
  dueDate: Date,
  remaining: number,
  face: number,
): BillStatus {
  if (remaining <= 0 && face > 0) return BillStatus.PAID;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? BillStatus.OVERDUE : BillStatus.OPEN;
}

function isManagerRole(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('manager');
}

/**
 * Requisição = compra do cliente para pagar depois (limite de requisição).
 * No PDV ela nasce como venda com pagamento REQUISITION; esta tela mostra
 * todas elas e permite lançar novas fora do PDV, sempre amarradas a um caixa
 * aberto. O estoque baixa na gravação, igual à venda.
 */
@Injectable()
export class RequisitionsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Caixas abertos elegíveis: gerente lança em qualquer um, operador só no próprio. */
  async openCashSessions(tenantSlug: string, user: ActingUser) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sessions = await db.cashRegisterSession.findMany({
      where: {
        status: CashSessionStatus.OPEN,
        ...(isManagerRole(user.roles) ? {} : { userId: user.sub }),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'asc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      controlNumber: s.controlNumber,
      operator: s.user?.name ?? '—',
      operatorId: s.userId,
      openedAt: s.openedAt,
      openingBalance: Number(s.openingBalance),
      isMine: s.userId === user.sub,
    }));
  }

  async list(
    tenantSlug: string,
    opts: {
      status?: string;
      from?: string;
      to?: string;
      customerId?: string;
      take?: number;
    } = {},
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);

    const where: Prisma.SaleWhereInput = {
      payments: { some: { method: PaymentMethod.REQUISITION } },
    };
    if (opts.status === 'COMPLETED' || opts.status === 'CANCELLED') {
      where.status = opts.status as SaleStatus;
    }
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.from || opts.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (opts.from) {
        const d = new Date(opts.from);
        if (!Number.isNaN(d.getTime())) createdAt.gte = d;
      }
      if (opts.to) {
        const d = new Date(opts.to);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          createdAt.lte = d;
        }
      }
      where.createdAt = createdAt;
    }

    const take = Number.isFinite(opts.take)
      ? Math.min(Math.max(1, Number(opts.take)), 500)
      : 200;

    const rows = await db.sale.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, document: true } },
        user: { select: { id: true, name: true } },
        cashSession: {
          select: {
            id: true,
            controlNumber: true,
            status: true,
            user: { select: { name: true } },
          },
        },
        payments: { where: { method: PaymentMethod.REQUISITION } },
        receivables: {
          select: {
            id: true,
            status: true,
            amount: true,
            amountRemaining: true,
            dueDate: true,
          },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return rows.map((sale) => this.toListRow(sale));
  }

  private toListRow(sale: {
    id: string;
    number: number;
    status: SaleStatus;
    source: SaleSource;
    createdAt: Date;
    total: Prisma.Decimal;
    notes: string | null;
    customer: { id: string; name: string; document: string | null } | null;
    user: { id: string; name: string } | null;
    cashSession: {
      id: string;
      controlNumber: number;
      status: CashSessionStatus;
      user: { name: string } | null;
    } | null;
    payments: Array<{ installments: number }>;
    receivables: Array<{
      status: BillStatus;
      amount: Prisma.Decimal;
      amountRemaining: Prisma.Decimal;
      dueDate: Date;
    }>;
    _count: { items: number };
  }) {
    const openTitles = sale.receivables.filter(
      (r) => r.status === BillStatus.OPEN || r.status === BillStatus.OVERDUE,
    );
    const remaining = openTitles.reduce(
      (s, r) => s + Number(r.amountRemaining),
      0,
    );
    const nextDue = openTitles
      .map((r) => r.dueDate)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    return {
      id: sale.id,
      number: sale.number,
      status: sale.status,
      source: sale.source,
      createdAt: sale.createdAt,
      total: Number(sale.total),
      notes: sale.notes,
      itemCount: sale._count.items,
      installments: sale.payments[0]?.installments ?? 1,
      customer: sale.customer,
      operator: sale.user?.name ?? null,
      cashSession: sale.cashSession
        ? {
            id: sale.cashSession.id,
            controlNumber: sale.cashSession.controlNumber,
            status: sale.cashSession.status,
            operator: sale.cashSession.user?.name ?? null,
          }
        : null,
      titles: {
        total: sale.receivables.length,
        open: openTitles.length,
        remaining: roundMoney2(remaining),
        nextDueDate: nextDue ?? null,
      },
    };
  }

  async detail(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({
      where: { id },
      include: {
        customer: {
          select: { id: true, name: true, document: true, phone: true },
        },
        user: { select: { id: true, name: true } },
        cashSession: {
          select: {
            id: true,
            controlNumber: true,
            status: true,
            user: { select: { name: true } },
          },
        },
        payments: true,
        receivables: { orderBy: { dueDate: 'asc' } },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                product: {
                  select: { id: true, name: true, controlNumber: true },
                },
              },
            },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException('Requisição não encontrada.');
    this.assertIsRequisition(sale.payments);

    return {
      id: sale.id,
      number: sale.number,
      status: sale.status,
      source: sale.source,
      createdAt: sale.createdAt,
      total: Number(sale.total),
      subtotal: Number(sale.subtotal),
      notes: sale.notes,
      customer: sale.customer,
      operator: sale.user?.name ?? null,
      cashSession: sale.cashSession
        ? {
            id: sale.cashSession.id,
            controlNumber: sale.cashSession.controlNumber,
            status: sale.cashSession.status,
            operator: sale.cashSession.user?.name ?? null,
          }
        : null,
      installments:
        sale.payments.find((p) => p.method === PaymentMethod.REQUISITION)
          ?.installments ?? 1,
      items: sale.items.map((it) => ({
        id: it.id,
        variantId: it.variantId,
        sku: it.variant.sku,
        productName: it.variant.product.name,
        productControlNumber: it.variant.product.controlNumber,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        totalLine: Number(it.totalLine),
      })),
      receivables: sale.receivables.map((r) => ({
        id: r.id,
        description: r.description,
        status: r.status,
        amount: Number(r.amount),
        amountRemaining: Number(r.amountRemaining),
        dueDate: r.dueDate,
        recurrenceIndex: r.recurrenceIndex,
        recurrenceCount: r.recurrenceCount,
      })),
    };
  }

  private assertIsRequisition(payments: Array<{ method: PaymentMethod }>) {
    if (!payments.some((p) => p.method === PaymentMethod.REQUISITION)) {
      throw new BadRequestException('Este lançamento não é uma requisição.');
    }
  }

  async create(
    tenantSlug: string,
    user: ActingUser,
    input: CreateRequisitionInput,
  ) {
    const customerId = String(input?.customerId ?? '').trim();
    if (!customerId) {
      throw new BadRequestException('Informe o cliente da requisição.');
    }
    const cashSessionId = String(input?.cashSessionId ?? '').trim();
    if (!cashSessionId) {
      throw new BadRequestException(
        'Selecione o caixa aberto que responde pela requisição.',
      );
    }
    if (!Array.isArray(input?.items) || input.items.length === 0) {
      throw new BadRequestException(
        'Inclua ao menos um produto na requisição.',
      );
    }
    const dueDateRaw = String(input?.dueDate ?? '').trim();
    if (!dueDateRaw) {
      throw new BadRequestException('Informe o vencimento da requisição.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);

    const session = await db.cashRegisterSession.findUnique({
      where: { id: cashSessionId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!session) throw new NotFoundException('Caixa não encontrado.');
    if (session.status !== CashSessionStatus.OPEN) {
      throw new BadRequestException(
        `O caixa #${session.controlNumber} está fechado. A requisição só pode ser lançada em caixa aberto.`,
      );
    }
    if (session.userId !== user.sub && !isManagerRole(user.roles)) {
      throw new BadRequestException(
        'Somente gerente pode lançar requisição no caixa de outro operador.',
      );
    }

    const items = input.items.map((raw) => {
      const variantId = String(raw?.variantId ?? '').trim();
      if (!variantId)
        throw new BadRequestException('Produto inválido na lista de itens.');
      const quantity = Number(raw?.quantity);
      const unitPrice = Number(raw?.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(
          'Quantidade inválida — informe um valor maior que zero.',
        );
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new BadRequestException('Preço unitário inválido.');
      }
      return { variantId, quantity, unitPrice };
    });

    // Mesmo cálculo do total usado em SalesService (sem desconto, acréscimo ou frete).
    const total = roundMoney2(
      items.reduce(
        (sum, it) => sum + roundMoney2(it.quantity * it.unitPrice),
        0,
      ),
    );
    if (total <= 0) {
      throw new BadRequestException(
        'O total da requisição precisa ser maior que zero.',
      );
    }

    const installments = Math.min(
      Math.max(1, Math.floor(Number(input.installments ?? 1)) || 1),
      MAX_INSTALLMENTS,
    );

    /**
     * A venda fica no nome do operador do caixa escolhido: é assim que ela entra
     * na conferência daquele caixa (a associação venda × caixa é por operador +
     * janela de tempo). Quem realmente lançou fica registrado no log de atividade.
     */
    const sale = await this.sales.create({
      tenantSlug,
      userId: session.userId,
      userRoles: user.roles,
      customerId,
      cashSessionId: session.id,
      source: SaleSource.REQUISITION,
      notes: input.notes?.trim() || null,
      requisitionDueDate: dueDateRaw,
      items: items.map((it) => ({
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
      })),
      payments: [
        { method: PaymentMethod.REQUISITION, amount: total, installments },
      ],
    });

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CREATE,
      summary:
        `Lançou requisição #${sale.number} de R$ ${total.toFixed(2)} no caixa controle ` +
        `${session.controlNumber} (operador ${session.user?.name ?? '—'}) — ` +
        `${items.length} produto(s), ${installments}x, vencimento ${dueDateRaw}`,
      entityType: 'requisition',
      entityRef: `#${sale.number}`,
    });

    return sale;
  }

  /**
   * Cancelar = cancelar a venda: estorna o estoque, apaga as parcelas a receber
   * (liberando o limite do cliente) e exige a permissão de cancelamento de venda.
   */
  async cancel(
    tenantSlug: string,
    user: ActingUser,
    id: string,
    permissionPassword?: string,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({
      where: { id },
      select: { id: true, payments: { select: { method: true } } },
    });
    if (!sale) throw new NotFoundException('Requisição não encontrada.');
    this.assertIsRequisition(sale.payments);

    return this.sales.cancel(
      tenantSlug,
      id,
      user.sub,
      user.roles,
      permissionPassword,
    );
  }

  /** Altera observações e vencimentos das parcelas em aberto (sem baixa parcial). */
  async update(
    tenantSlug: string,
    user: { sub: string },
    id: string,
    input: UpdateRequisitionInput,
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);

    await db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          payments: { select: { method: true } },
          receivables: {
            include: { settlements: { select: { id: true } } },
          },
        },
      });
      if (!sale) throw new NotFoundException('Requisição não encontrada.');
      this.assertIsRequisition(sale.payments);
      if (sale.status === SaleStatus.CANCELLED) {
        throw new BadRequestException('Requisição cancelada não pode ser alterada.');
      }

      if (input.notes !== undefined) {
        await tx.sale.update({
          where: { id },
          data: { notes: input.notes?.trim() || null },
        });
      }

      if (input.receivables?.length) {
        const byId = new Map(sale.receivables.map((r) => [r.id, r]));
        for (const patch of input.receivables) {
          const row = byId.get(String(patch.id ?? '').trim());
          if (!row) {
            throw new BadRequestException('Parcela não pertence a esta requisição.');
          }
          if (row.status !== BillStatus.OPEN && row.status !== BillStatus.OVERDUE) {
            throw new BadRequestException(
              `Parcela "${row.description}" não está em aberto.`,
            );
          }
          if (row.settlements.length > 0) {
            throw new BadRequestException(
              `Parcela "${row.description}" já possui baixa parcial.`,
            );
          }
          const due = parseDayStart(patch.dueDate);
          if (!due) {
            throw new BadRequestException('Vencimento inválido (use YYYY-MM-DD).');
          }
          const face = Number(row.amount);
          const remaining = Number(row.amountRemaining);
          await tx.accountReceivable.update({
            where: { id: row.id },
            data: {
              dueDate: due,
              status: billStatusFromDue(due, remaining, face),
            },
          });
        }
      }
    });

    const updated = await this.detail(tenantSlug, id);

    this.activityLog.record({
      tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.UPDATE,
      summary: `Alterou requisição #${updated.number}`,
      entityType: 'requisition',
      entityRef: `#${updated.number}`,
    });

    return updated;
  }
}
