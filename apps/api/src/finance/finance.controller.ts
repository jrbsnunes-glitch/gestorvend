import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  BillStatus,
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
  Prisma,
  Recurrence,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SettleBillBodyDto } from './dto/settle-bill-body.dto';
import { UpdateSettlementBodyDto } from './dto/update-settlement-body.dto';
import {
  referentialCodeAllowedForPayableCostCenter,
  referentialCodeMatchesFlow,
  type ReferentialAccountFlow,
} from '../common/referential-account-flow';

type RecurrenceInput = 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

function parseDay(raw: string | undefined, mode: 'start' | 'end'): Date | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (mode === 'end') date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
    return date;
  }
  const date = new Date(s);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function todayLocalStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function moneyCents(n: number): number {
  return Math.round(n * 100);
}

/** Converte Decimal/string/number do Prisma em número finito (evita NaN em pagamentos parciais). */
function prismaMoney(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return n;
  }
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && v !== null) {
    const o = v as { toNumber?: () => number; toString?: () => string };
    if (typeof o.toNumber === 'function') {
      try {
        const n = o.toNumber();
        if (Number.isFinite(n)) return n;
      } catch {
        /* fall through */
      }
    }
    if (typeof o.toString === 'function') {
      const n = Number(o.toString());
      if (Number.isFinite(n)) return n;
    }
  }
  return Number(v);
}

function fmtBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parsePaymentMethod(raw: string): PaymentMethod {
  const u = String(raw ?? '').trim().toUpperCase();
  if (u === 'EXPENSE') {
    throw new BadRequestException(
      '“Despesas” é exclusiva de movimento de caixa; use Dinheiro, Pix, cartão ou outro na baixa.',
    );
  }
  if (u === 'CASH' || u === 'CARD' || u === 'PIX' || u === 'CREDIT' || u === 'OTHER') {
    return u as PaymentMethod;
  }
  throw new BadRequestException('Forma de pagamento inválida.');
}

async function resolveReferentialCostCenterId(
  tx: Prisma.TransactionClient,
  referentialAccountId: string | null | undefined,
  flow: ReferentialAccountFlow,
): Promise<string | null> {
  if (referentialAccountId == null || String(referentialAccountId).trim() === '') {
    return null;
  }
  const id = String(referentialAccountId).trim();
  const acc = await tx.referentialAccount.findUnique({ where: { id } });
  if (!acc) {
    throw new BadRequestException('Centro de custo (plano referencial) não encontrado.');
  }
  if (flow === 'OUT') {
    if (!referentialCodeAllowedForPayableCostCenter(acc.code)) {
      throw new BadRequestException(
        'Para pagamentos a fornecedores, não use contas de receita (grupo 6) como centro de custo.',
      );
    }
  } else if (!referentialCodeMatchesFlow(acc.code, flow)) {
    throw new BadRequestException(
      'Para recebimentos, o centro de custo deve ser conta de grupo 6 (receitas).',
    );
  }
  return id;
}

/** Cria N datas de vencimento a partir da primeira, conforme a periodicidade. */
function buildRecurringDueDates(
  firstDue: Date,
  recurrence: RecurrenceInput,
  count: number,
): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(firstDue.getTime());
    if (recurrence === 'WEEKLY') d.setDate(d.getDate() + 7 * i);
    else if (recurrence === 'MONTHLY') d.setMonth(d.getMonth() + i);
    else if (recurrence === 'YEARLY') d.setFullYear(d.getFullYear() + i);
    out.push(d);
  }
  return out;
}

/** Divide valor total em N parcelas iguais (ajuste de centavos na última). */
function splitAmountEvenly(total: number, count: number): number[] {
  const totalCents = moneyCents(total);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, i) => (baseCents + (i < remainder ? 1 : 0)) / 100);
}

type BillSeriesPlan = {
  count: number;
  dues: Date[];
  amounts: number[];
  dbRecurrence: Recurrence;
};

/**
 * Sem recorrência + N parcelas: divide o valor total em N títulos mensais.
 * Com recorrência: repete o valor informado N vezes na periodicidade escolhida.
 */
function planBillSeries(
  amount: number,
  firstDue: Date,
  recurrence: RecurrenceInput,
  recurrenceCount: number,
): BillSeriesPlan {
  const count = Math.max(1, Math.min(120, Number(recurrenceCount) | 0));
  const splitTotal = recurrence === 'NONE' && count > 1;

  if (count === 1) {
    return {
      count: 1,
      dues: [firstDue],
      amounts: [amount],
      dbRecurrence: Recurrence[recurrence],
    };
  }

  if (splitTotal) {
    return {
      count,
      dues: buildRecurringDueDates(firstDue, 'MONTHLY', count),
      amounts: splitAmountEvenly(amount, count),
      dbRecurrence: Recurrence.NONE,
    };
  }

  return {
    count,
    dues: buildRecurringDueDates(firstDue, recurrence, count),
    amounts: Array.from({ length: count }, () => amount),
    dbRecurrence: Recurrence[recurrence],
  };
}

const BILL_STATUS_SET = new Set<string>(['OPEN', 'PAID', 'OVERDUE', 'CANCELLED']);

/** Vários status (ex.: impressão "em aberto": OPEN + OVERDUE). */
function parseBillStatusList(statusRaw: string | undefined, statusInRaw: string | undefined): BillStatus[] | null {
  if (statusInRaw != null && String(statusInRaw).trim() !== '') {
    const parts = String(statusInRaw)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => BILL_STATUS_SET.has(s));
    if (parts.length) return parts as BillStatus[];
  }
  if (
    statusRaw === 'OPEN' ||
    statusRaw === 'PAID' ||
    statusRaw === 'OVERDUE' ||
    statusRaw === 'CANCELLED'
  ) {
    return [statusRaw as BillStatus];
  }
  return null;
}

function payableDateFilterField(statuses: BillStatus[] | null): 'paidAt' | 'dueDate' {
  if (statuses?.length && statuses.every((s) => s === BillStatus.PAID)) {
    return 'paidAt';
  }
  return 'dueDate';
}

function receivableDateFilterField(statuses: BillStatus[] | null): 'receivedAt' | 'dueDate' {
  if (statuses?.length && statuses.every((s) => s === BillStatus.PAID)) {
    return 'receivedAt';
  }
  return 'dueDate';
}

const payableInclude = {
  supplier: true,
  cashSession: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;

const receivableInclude = {
  customer: true,
  sale: true,
  cashSession: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;

const settlementDetailInclude = {
  cashSession: { include: { user: { select: { id: true, name: true, email: true } } } },
  referentialAccount: { select: { id: true, code: true, description: true } },
} as const;

const payableDetailInclude = {
  ...payableInclude,
  settlements: {
    orderBy: { paidAt: 'asc' as const },
    include: settlementDetailInclude,
  },
} as const;

const receivableDetailInclude = {
  ...receivableInclude,
  settlements: {
    orderBy: { receivedAt: 'asc' as const },
    include: settlementDetailInclude,
  },
} as const;

type SettlementNoteRow = {
  amount: unknown;
  paidAt?: Date;
  receivedAt?: Date;
  notes?: string | null;
};

function resolveBillStatusAfterSettlement(
  dueDate: Date,
  remainingCents: number,
  faceCents: number,
): BillStatus {
  if (remainingCents <= 0 && faceCents > 0) {
    return BillStatus.PAID;
  }
  const today = todayLocalStart();
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? BillStatus.OVERDUE : BillStatus.OPEN;
}

function rebuildPaymentNotesFromSettlements(
  settlements: SettlementNoteRow[],
  kind: 'payable' | 'receivable',
  fullyPaid: boolean,
): string | null {
  if (!settlements.length) return null;
  if (settlements.length === 1 && fullyPaid) {
    return settlements[0].notes?.trim() ?? null;
  }
  return settlements
    .map((s) => {
      const at = (kind === 'payable' ? s.paidAt! : s.receivedAt!).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const note = s.notes?.trim();
      return `[Parcial ${at}] ${fmtBRL(prismaMoney(s.amount))}${note ? ` — ${note}` : ''}`;
    })
    .join('\n')
    .slice(0, 4000);
}

function parseSettledAt(raw: string | undefined): Date | undefined {
  if (raw == null || String(raw).trim() === '') return undefined;
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException('Data/hora do pagamento inválida.');
  }
  return d;
}

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('payables')
  @Roles('admin', 'manager', 'finance')
  async payables(
    @CurrentUser() user: JwtPayload,
    @Query('status') statusRaw?: string,
    @Query('statusIn') statusInRaw?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('supplierId') supplierId?: string,
    @Query('segment') segment?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: Prisma.AccountPayableWhereInput = {};

    const statusList = parseBillStatusList(statusRaw, statusInRaw);
    if (statusList?.length === 1) {
      where.status = statusList[0];
    } else if (statusList && statusList.length > 1) {
      where.status = { in: statusList };
    }

    const fromD = parseDay(fromRaw, 'start');
    const toD = parseDay(toRaw, 'end');
    if (fromRaw && !fromD) throw new BadRequestException('Data inicial inválida (use YYYY-MM-DD).');
    if (toRaw && !toD) throw new BadRequestException('Data final inválida (use YYYY-MM-DD).');

    if (fromD || toD) {
      const field = payableDateFilterField(statusList);
      where[field] = {
        ...(fromD ? { gte: fromD } : {}),
        ...(toD ? { lte: toD } : {}),
      };
    }

    if (supplierId != null && String(supplierId).trim() !== '') {
      where.supplierId = String(supplierId).trim();
    }
    if (segment != null && String(segment).trim() !== '') {
      where.supplier = { segment: String(segment).trim() };
    }

    return db.accountPayable.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: payableInclude,
    });
  }

  @Get('payables/:id')
  @Roles('admin', 'manager', 'finance')
  async payableById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.accountPayable.findUnique({
      where: { id },
      include: payableDetailInclude,
    });
    if (!row) throw new NotFoundException('Conta a pagar não encontrada.');
    return row;
  }

  @Post('payables')
  @Roles('admin', 'manager', 'finance')
  async createPayable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      supplierId?: string | null;
      description: string;
      category?: string | null;
      amount: number;
      dueDate: string;
      recurrence?: RecurrenceInput;
      recurrenceCount?: number;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const description = String(body.description ?? '').trim();
    if (!description) {
      throw new BadRequestException('Descrição é obrigatória.');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor inválido.');
    }
    const firstDue = new Date(body.dueDate);
    if (Number.isNaN(firstDue.getTime())) {
      throw new BadRequestException('Vencimento inválido.');
    }
    const recurrence: RecurrenceInput = body.recurrence ?? 'NONE';
    const plan = planBillSeries(amount, firstDue, recurrence, body.recurrenceCount ?? 1);

    if (plan.count === 1) {
      return db.accountPayable.create({
        data: {
          supplierId: body.supplierId ?? null,
          description,
          category: body.category ?? null,
          amount: plan.amounts[0].toFixed(2),
          amountRemaining: plan.amounts[0].toFixed(2),
          dueDate: plan.dues[0],
          status: BillStatus.OPEN,
          recurrence: plan.dbRecurrence,
        },
      });
    }

    return db.$transaction(async (tx) => {
      let parentId: string | null = null;
      let parent: { id: string } | null = null;
      for (let i = 0; i < plan.count; i++) {
        const amtStr = plan.amounts[i].toFixed(2);
        const created: { id: string } = await tx.accountPayable.create({
          data: {
            supplierId: body.supplierId ?? null,
            description: `${description} (${i + 1}/${plan.count})`,
            category: body.category ?? null,
            amount: amtStr,
            amountRemaining: amtStr,
            dueDate: plan.dues[i],
            status: BillStatus.OPEN,
            recurrence: plan.dbRecurrence,
            recurrenceIndex: i + 1,
            recurrenceCount: plan.count,
            parentRecurringId: parentId,
          },
        });
        if (i === 0) {
          parentId = created.id;
          parent = created;
        }
      }
      return parent!;
    });
  }

  @Patch('payables/:id/pay')
  @Roles('admin', 'manager', 'finance')
  async payPayable(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: SettleBillBodyDto,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const notes =
      body.notes != null && String(body.notes).trim() !== ''
        ? String(body.notes).trim().slice(0, 4000)
        : null;
    const cashSessionId =
      body.cashSessionId != null && String(body.cashSessionId).trim() !== ''
        ? String(body.cashSessionId).trim()
        : null;

    return db.$transaction(async (tx) => {
      const row = await tx.accountPayable.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Conta a pagar não encontrada.');
      if (row.status !== BillStatus.OPEN && row.status !== BillStatus.OVERDUE) {
        throw new BadRequestException('Somente títulos em aberto podem ser baixados.');
      }
      const remaining = prismaMoney(row.amountRemaining);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw new BadRequestException('Título sem saldo em aberto.');
      }
      const payAmount =
        body.amount != null && Number.isFinite(Number(body.amount))
          ? Number(body.amount)
          : remaining;
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        throw new BadRequestException('Valor do pagamento inválido.');
      }
      if (moneyCents(payAmount) > moneyCents(remaining)) {
        throw new BadRequestException(
          `O valor informado (${fmtBRL(payAmount)}) é superior ao saldo em aberto (${fmtBRL(remaining)}). Baixa total não foi realizada.`,
        );
      }
      const method =
        body?.method != null && String(body.method).trim() !== ''
          ? parsePaymentMethod(String(body.method))
          : PaymentMethod.OTHER;

      const referentialAccountId = await resolveReferentialCostCenterId(
        tx,
        body.referentialAccountId,
        'OUT',
      );

      const paidAt = new Date();
      if (cashSessionId) {
        const sess = await tx.cashRegisterSession.findFirst({
          where: { id: cashSessionId, status: CashSessionStatus.OPEN },
        });
        if (!sess) {
          throw new BadRequestException('Caixa inválido ou já fechado.');
        }
        if (!sameLocalCalendarDay(sess.openedAt, paidAt)) {
          throw new BadRequestException('Selecione um caixa aberto no dia de hoje.');
        }
        await tx.cashMovement.create({
          data: {
            sessionId: sess.id,
            type: CashMovementType.OUT,
            amount: payAmount.toFixed(2),
            method,
            reason: `Pagamento: ${row.description}`.slice(0, 500),
            referentialAccountId,
          },
        });
      }

      await tx.payableSettlement.create({
        data: {
          payableId: id,
          amount: payAmount.toFixed(2),
          paidAt,
          method,
          cashSessionId: cashSessionId ?? null,
          notes: notes ?? undefined,
          referentialAccountId,
        },
      });

      const newRem = (moneyCents(remaining) - moneyCents(payAmount)) / 100;
      const face = prismaMoney(row.amount);
      if (!Number.isFinite(face) || face < 0) {
        throw new BadRequestException('Dados do título inconsistentes (valor inválido).');
      }

      if (moneyCents(newRem) === 0) {
        return tx.accountPayable.update({
          where: { id },
          data: {
            status: BillStatus.PAID,
            paidAt,
            amountRemaining: '0.00',
            paymentMethod: method,
            settledAmount: face.toFixed(2),
            cashSessionId,
            paymentNotes: notes,
          },
          include: payableInclude,
        });
      }

      const paidSoFar = face - newRem;
      const payAtStr = paidAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const partialLine = `[Parcial ${payAtStr}] ${fmtBRL(payAmount)}${notes ? ` — ${notes}` : ''}`;
      const prevNotes = row.paymentNotes?.trim() ?? '';
      const combinedNotes = [prevNotes, partialLine].filter(Boolean).join('\n').slice(0, 4000);

      return tx.accountPayable.update({
        where: { id },
        data: {
          amountRemaining: newRem.toFixed(2),
          paymentMethod: method,
          settledAmount: paidSoFar.toFixed(2),
          cashSessionId: null,
          paymentNotes: combinedNotes,
        },
        include: payableInclude,
      });
    });
  }

  @Get('receivables')
  @Roles('admin', 'manager', 'finance')
  async receivables(
    @CurrentUser() user: JwtPayload,
    @Query('status') statusRaw?: string,
    @Query('statusIn') statusInRaw?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('customerId') customerId?: string,
    @Query('segment') segment?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: Prisma.AccountReceivableWhereInput = {};

    const statusList = parseBillStatusList(statusRaw, statusInRaw);
    if (statusList?.length === 1) {
      where.status = statusList[0];
    } else if (statusList && statusList.length > 1) {
      where.status = { in: statusList };
    }

    const fromD = parseDay(fromRaw, 'start');
    const toD = parseDay(toRaw, 'end');
    if (fromRaw && !fromD) throw new BadRequestException('Data inicial inválida (use YYYY-MM-DD).');
    if (toRaw && !toD) throw new BadRequestException('Data final inválida (use YYYY-MM-DD).');

    if (fromD || toD) {
      const field = receivableDateFilterField(statusList);
      where[field] = {
        ...(fromD ? { gte: fromD } : {}),
        ...(toD ? { lte: toD } : {}),
      };
    }

    if (customerId != null && String(customerId).trim() !== '') {
      where.customerId = String(customerId).trim();
    }
    if (segment != null && String(segment).trim() !== '') {
      where.customer = { segment: String(segment).trim() };
    }

    return db.accountReceivable.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: receivableInclude,
    });
  }

  @Get('receivables/:id')
  @Roles('admin', 'manager', 'finance')
  async receivableById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.accountReceivable.findUnique({
      where: { id },
      include: receivableDetailInclude,
    });
    if (!row) throw new NotFoundException('Conta a receber não encontrada.');
    return row;
  }

  @Post('receivables')
  @Roles('admin', 'manager', 'finance')
  async createReceivable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId?: string | null;
      description: string;
      amount: number;
      dueDate: string;
      recurrence?: RecurrenceInput;
      recurrenceCount?: number;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const description = String(body.description ?? '').trim();
    if (!description) {
      throw new BadRequestException('Descrição é obrigatória.');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Valor inválido.');
    }
    const firstDue = new Date(body.dueDate);
    if (Number.isNaN(firstDue.getTime())) {
      throw new BadRequestException('Vencimento inválido.');
    }
    const recurrence: RecurrenceInput = body.recurrence ?? 'NONE';
    const plan = planBillSeries(amount, firstDue, recurrence, body.recurrenceCount ?? 1);

    if (plan.count === 1) {
      return db.accountReceivable.create({
        data: {
          customerId: body.customerId ?? null,
          description,
          amount: plan.amounts[0].toFixed(2),
          amountRemaining: plan.amounts[0].toFixed(2),
          dueDate: plan.dues[0],
          status: BillStatus.OPEN,
          recurrence: plan.dbRecurrence,
        },
      });
    }

    return db.$transaction(async (tx) => {
      let parentId: string | null = null;
      let parent: { id: string } | null = null;
      for (let i = 0; i < plan.count; i++) {
        const amtStr = plan.amounts[i].toFixed(2);
        const created: { id: string } = await tx.accountReceivable.create({
          data: {
            customerId: body.customerId ?? null,
            description: `${description} (${i + 1}/${plan.count})`,
            amount: amtStr,
            amountRemaining: amtStr,
            dueDate: plan.dues[i],
            status: BillStatus.OPEN,
            recurrence: plan.dbRecurrence,
            recurrenceIndex: i + 1,
            recurrenceCount: plan.count,
            parentRecurringId: parentId,
          },
        });
        if (i === 0) {
          parentId = created.id;
          parent = created;
        }
      }
      return parent!;
    });
  }

  @Patch('receivables/:id/receive')
  @Roles('admin', 'manager', 'finance')
  async receive(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: SettleBillBodyDto,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const notes =
      body.notes != null && String(body.notes).trim() !== ''
        ? String(body.notes).trim().slice(0, 4000)
        : null;
    const cashSessionId =
      body.cashSessionId != null && String(body.cashSessionId).trim() !== ''
        ? String(body.cashSessionId).trim()
        : null;

    return db.$transaction(async (tx) => {
      const row = await tx.accountReceivable.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Conta a receber não encontrada.');
      if (row.status !== BillStatus.OPEN && row.status !== BillStatus.OVERDUE) {
        throw new BadRequestException('Somente títulos em aberto podem ser recebidos.');
      }
      const remaining = prismaMoney(row.amountRemaining);
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw new BadRequestException('Título sem saldo em aberto.');
      }
      const recvAmount =
        body.amount != null && Number.isFinite(Number(body.amount))
          ? Number(body.amount)
          : remaining;
      if (!Number.isFinite(recvAmount) || recvAmount <= 0) {
        throw new BadRequestException('Valor do recebimento inválido.');
      }
      if (moneyCents(recvAmount) > moneyCents(remaining)) {
        throw new BadRequestException(
          `O valor informado (${fmtBRL(recvAmount)}) é superior ao saldo em aberto (${fmtBRL(remaining)}). Baixa total não foi realizada.`,
        );
      }
      const method =
        body?.method != null && String(body.method).trim() !== ''
          ? parsePaymentMethod(String(body.method))
          : PaymentMethod.OTHER;

      const referentialAccountId = await resolveReferentialCostCenterId(
        tx,
        body.referentialAccountId,
        'IN',
      );

      const receivedAt = new Date();
      if (cashSessionId) {
        const sess = await tx.cashRegisterSession.findFirst({
          where: { id: cashSessionId, status: CashSessionStatus.OPEN },
        });
        if (!sess) {
          throw new BadRequestException('Caixa inválido ou já fechado.');
        }
        if (!sameLocalCalendarDay(sess.openedAt, receivedAt)) {
          throw new BadRequestException('Selecione um caixa aberto no dia de hoje.');
        }
        await tx.cashMovement.create({
          data: {
            sessionId: sess.id,
            type: CashMovementType.IN,
            amount: recvAmount.toFixed(2),
            method,
            reason: `Recebimento: ${row.description}`.slice(0, 500),
            referentialAccountId,
          },
        });
      }

      await tx.receivableSettlement.create({
        data: {
          receivableId: id,
          amount: recvAmount.toFixed(2),
          receivedAt,
          method,
          cashSessionId: cashSessionId ?? null,
          notes: notes ?? undefined,
          referentialAccountId,
        },
      });

      const newRem = (moneyCents(remaining) - moneyCents(recvAmount)) / 100;
      const face = prismaMoney(row.amount);
      if (!Number.isFinite(face) || face < 0) {
        throw new BadRequestException('Dados do título inconsistentes (valor inválido).');
      }

      if (moneyCents(newRem) === 0) {
        return tx.accountReceivable.update({
          where: { id },
          data: {
            status: BillStatus.PAID,
            receivedAt,
            amountRemaining: '0.00',
            paymentMethod: method,
            settledAmount: face.toFixed(2),
            cashSessionId,
            paymentNotes: notes,
          },
          include: receivableInclude,
        });
      }

      const receivedSoFar = face - newRem;
      const recvAtStr = receivedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const partialLine = `[Parcial ${recvAtStr}] ${fmtBRL(recvAmount)}${notes ? ` — ${notes}` : ''}`;
      const prevNotes = row.paymentNotes?.trim() ?? '';
      const combinedNotes = [prevNotes, partialLine].filter(Boolean).join('\n').slice(0, 4000);

      return tx.accountReceivable.update({
        where: { id },
        data: {
          amountRemaining: newRem.toFixed(2),
          paymentMethod: method,
          settledAmount: receivedSoFar.toFixed(2),
          cashSessionId: null,
          paymentNotes: combinedNotes,
        },
        include: receivableInclude,
      });
    });
  }

  private async recalculatePayableFromSettlements(
    tx: Prisma.TransactionClient,
    payableId: string,
  ) {
    const row = await tx.accountPayable.findUnique({ where: { id: payableId } });
    if (!row) throw new NotFoundException('Conta a pagar não encontrada.');
    if (row.status === BillStatus.CANCELLED) {
      throw new BadRequestException('Título cancelado não pode ser alterado.');
    }

    const settlements = await tx.payableSettlement.findMany({
      where: { payableId },
      orderBy: { paidAt: 'asc' },
    });
    const face = prismaMoney(row.amount);
    const faceCents = moneyCents(face);
    let totalCents = 0;
    for (const s of settlements) {
      totalCents += moneyCents(prismaMoney(s.amount));
    }
    if (totalCents > faceCents) {
      throw new BadRequestException(
        `Total dos pagamentos (${fmtBRL(totalCents / 100)}) excede o valor do título (${fmtBRL(face)}).`,
      );
    }

    const remainingCents = faceCents - totalCents;
    const last = settlements[settlements.length - 1];
    const fullyPaid = remainingCents === 0 && totalCents > 0;
    const status = resolveBillStatusAfterSettlement(row.dueDate, remainingCents, faceCents);
    const paymentNotes = rebuildPaymentNotesFromSettlements(settlements, 'payable', fullyPaid);

    return tx.accountPayable.update({
      where: { id: payableId },
      data: {
        status,
        amountRemaining: (remainingCents / 100).toFixed(2),
        settledAmount: totalCents > 0 ? (totalCents / 100).toFixed(2) : null,
        paymentMethod: last?.method ?? null,
        paidAt: fullyPaid ? (last?.paidAt ?? null) : null,
        cashSessionId: fullyPaid && settlements.length === 1 ? (last?.cashSessionId ?? null) : null,
        paymentNotes,
      },
      include: payableDetailInclude,
    });
  }

  private async recalculateReceivableFromSettlements(
    tx: Prisma.TransactionClient,
    receivableId: string,
  ) {
    const row = await tx.accountReceivable.findUnique({ where: { id: receivableId } });
    if (!row) throw new NotFoundException('Conta a receber não encontrada.');
    if (row.status === BillStatus.CANCELLED) {
      throw new BadRequestException('Título cancelado não pode ser alterado.');
    }

    const settlements = await tx.receivableSettlement.findMany({
      where: { receivableId },
      orderBy: { receivedAt: 'asc' },
    });
    const face = prismaMoney(row.amount);
    const faceCents = moneyCents(face);
    let totalCents = 0;
    for (const s of settlements) {
      totalCents += moneyCents(prismaMoney(s.amount));
    }
    if (totalCents > faceCents) {
      throw new BadRequestException(
        `Total dos recebimentos (${fmtBRL(totalCents / 100)}) excede o valor do título (${fmtBRL(face)}).`,
      );
    }

    const remainingCents = faceCents - totalCents;
    const last = settlements[settlements.length - 1];
    const fullyPaid = remainingCents === 0 && totalCents > 0;
    const status = resolveBillStatusAfterSettlement(row.dueDate, remainingCents, faceCents);
    const paymentNotes = rebuildPaymentNotesFromSettlements(settlements, 'receivable', fullyPaid);

    return tx.accountReceivable.update({
      where: { id: receivableId },
      data: {
        status,
        amountRemaining: (remainingCents / 100).toFixed(2),
        settledAmount: totalCents > 0 ? (totalCents / 100).toFixed(2) : null,
        paymentMethod: last?.method ?? null,
        receivedAt: fullyPaid ? (last?.receivedAt ?? null) : null,
        cashSessionId: fullyPaid && settlements.length === 1 ? (last?.cashSessionId ?? null) : null,
        paymentNotes,
      },
      include: receivableDetailInclude,
    });
  }

  @Patch('payable-settlements/:id')
  @Roles('admin', 'manager', 'finance')
  async updatePayableSettlement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateSettlementBodyDto,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.$transaction(async (tx) => {
      const settlement = await tx.payableSettlement.findUnique({
        where: { id },
        include: { payable: true },
      });
      if (!settlement) throw new NotFoundException('Pagamento não encontrado.');
      if (settlement.payable.status === BillStatus.CANCELLED) {
        throw new BadRequestException('Título cancelado não pode ser alterado.');
      }

      const data: Prisma.PayableSettlementUpdateInput = {};
      if (body.amount != null) {
        if (!Number.isFinite(body.amount) || body.amount <= 0) {
          throw new BadRequestException('Valor do pagamento inválido.');
        }
        data.amount = body.amount.toFixed(2);
      }
      if (body.method != null && String(body.method).trim() !== '') {
        data.method = parsePaymentMethod(String(body.method));
      }
      if (body.notes !== undefined) {
        data.notes =
          body.notes != null && String(body.notes).trim() !== ''
            ? String(body.notes).trim().slice(0, 4000)
            : null;
      }
      if (body.referentialAccountId !== undefined) {
        const refId = await resolveReferentialCostCenterId(
          tx,
          body.referentialAccountId,
          'OUT',
        );
        data.referentialAccount = refId
          ? { connect: { id: refId } }
          : { disconnect: true };
      }
      const settledAt = parseSettledAt(body.settledAt);
      if (settledAt) data.paidAt = settledAt;

      await tx.payableSettlement.update({ where: { id }, data });
      return this.recalculatePayableFromSettlements(tx, settlement.payableId);
    });
  }

  @Patch('receivable-settlements/:id')
  @Roles('admin', 'manager', 'finance')
  async updateReceivableSettlement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateSettlementBodyDto,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.$transaction(async (tx) => {
      const settlement = await tx.receivableSettlement.findUnique({
        where: { id },
        include: { receivable: true },
      });
      if (!settlement) throw new NotFoundException('Recebimento não encontrado.');
      if (settlement.receivable.status === BillStatus.CANCELLED) {
        throw new BadRequestException('Título cancelado não pode ser alterado.');
      }

      const data: Prisma.ReceivableSettlementUpdateInput = {};
      if (body.amount != null) {
        if (!Number.isFinite(body.amount) || body.amount <= 0) {
          throw new BadRequestException('Valor do recebimento inválido.');
        }
        data.amount = body.amount.toFixed(2);
      }
      if (body.method != null && String(body.method).trim() !== '') {
        data.method = parsePaymentMethod(String(body.method));
      }
      if (body.notes !== undefined) {
        data.notes =
          body.notes != null && String(body.notes).trim() !== ''
            ? String(body.notes).trim().slice(0, 4000)
            : null;
      }
      if (body.referentialAccountId !== undefined) {
        const refId = await resolveReferentialCostCenterId(
          tx,
          body.referentialAccountId,
          'IN',
        );
        data.referentialAccount = refId
          ? { connect: { id: refId } }
          : { disconnect: true };
      }
      const settledAt = parseSettledAt(body.settledAt);
      if (settledAt) data.receivedAt = settledAt;

      await tx.receivableSettlement.update({ where: { id }, data });
      return this.recalculateReceivableFromSettlements(tx, settlement.receivableId);
    });
  }
}
