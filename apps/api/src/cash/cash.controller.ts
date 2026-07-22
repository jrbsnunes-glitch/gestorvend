import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
  CashMovementType,
  CashSessionStatus,
  PaymentMethod,
  Prisma,
  SaleStatus,
  type PrismaClient,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ActivityLogAction } from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { referentialCodeMatchesFlow } from '../common/referential-account-flow';
import { assertLastSaleAllowsPdvEntry } from './pdv-entry.guard';
import {
  buildSalesByMethod,
  buildSessionExpectedByMethod,
  computeClosingBalanceFromDeclared,
  computeReconciliationDifference,
  expectedFinalForMethodKey,
} from './cash-session-expected';
import {
  clearReconciliationExpenseMovements,
  syncReconciliationExpenseMovements,
  type ReconciliationExpenseLineStored,
} from './cash-reconciliation-expense-sync';

function isPlainObjectRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// --- helpers de data (locais) -----------------------------------------------
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Faz o parsing de uma data vinda da query string respeitando o fuso horário
 * local do servidor. Aceita `YYYY-MM-DD` (formato dos <input type="date">) e
 * também timestamps ISO completos.
 *
 * Importante: `new Date("2026-05-12")` é interpretado como UTC midnight pelo
 * JS, o que joga a data um dia para trás em fusos negativos (Brasil = UTC-3
 * a UTC-4). Por isso fazemos o parse manual para `YYYY-MM-DD`.
 */
function parseQueryDate(raw: string, mode: 'start' | 'end'): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return mode === 'end' ? endOfDay(date) : startOfDay(date);
  }
  // ISO timestamp completo: respeita a hora informada.
  return new Date(raw);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Agrega total de vendas concluídas e diferença líquida (meios de recebimento; despesas fora do total). */
function computeSessionListAggregates(params: {
  sales: Array<{
    status: SaleStatus;
    total: unknown;
    payments: Array<{ method: string; amount: unknown }>;
  }>;
  movements: Array<{ type: CashMovementType; amount: unknown; method: PaymentMethod | null }>;
  openingBalance: unknown;
  closingByMethod: unknown;
}): { totalCompletedSales: number; reconciliationDifference: number | null } {
  let totalCompleted = 0;
  for (const sale of params.sales) {
    if (sale.status !== SaleStatus.COMPLETED) continue;
    totalCompleted += Number(sale.total);
  }

  const { byMethod } = buildSessionExpectedByMethod(params.sales, params.movements);
  const opening =
    parseFloat(String(params.openingBalance ?? '0').replace(',', '.')) || 0;

  const declared = (params.closingByMethod ?? null) as
    | Record<string, number | string>
    | null;

  const declaredNormalized: Record<string, number> | null = declared
    ? Object.fromEntries(
        Object.entries(declared)
          .map(([k, v]) => [
            k,
            typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')),
          ])
          .filter(([, v]) => Number.isFinite(v as number)) as Array<[string, number]>,
      )
    : null;

  const reconciliationDifference = computeReconciliationDifference(
    byMethod,
    declaredNormalized,
    opening,
  );

  return {
    totalCompletedSales: roundMoney(totalCompleted),
    reconciliationDifference,
  };
}

function normalizeClosingByMethodInput(
  raw: Record<string, number | string> | undefined | null,
): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const acc: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    const num =
      typeof val === 'number'
        ? val
        : parseFloat(String(val ?? '').replace(',', '.'));
    if (Number.isFinite(num) && num >= 0) {
      acc[key] = Math.round(num * 100) / 100;
    }
  }
  return Object.keys(acc).length > 0 ? acc : null;
}

type ReconciliationExpenseDetailOut = {
  amount: number;
  notes: string | null;
  referentialAccountId: string;
  cashMovementId?: string;
  referentialAccount?: { id: string; code: string; description: string } | null;
};

async function enrichReconciliationExpenseDetails(
  db: PrismaClient,
  raw: unknown,
  accountMap?: Map<string, { id: string; code: string; description: string }>,
): Promise<ReconciliationExpenseDetailOut[] | null> {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isPlainObjectRecord)) {
    return null;
  }
  const linesUnknown = raw.filter(isPlainObjectRecord) as Record<string, unknown>[];
  let map = accountMap;
  if (!map) {
    const ids = [
      ...new Set(
        linesUnknown
          .map((x) =>
            typeof x.referentialAccountId === 'string' ? x.referentialAccountId.trim() : '',
          )
          .filter(Boolean),
      ),
    ];
    const accs = ids.length
      ? await db.referentialAccount.findMany({
          where: { id: { in: ids } },
          select: { id: true, code: true, description: true },
        })
      : [];
    map = new Map(accs.map((a) => [a.id, a]));
  }
  return linesUnknown.map((line) => {
    const ridRaw = line.referentialAccountId;
    const rid =
      typeof ridRaw === 'string'
        ? ridRaw.trim()
        : ridRaw != null
          ? String(ridRaw).trim()
          : '';
    const amtRaw = line.amount;
    const amt =
      typeof amtRaw === 'number'
        ? amtRaw
        : parseFloat(String(amtRaw ?? '').replace(',', '.'));
    const amount = Number.isFinite(amt) ? Math.round(amt * 100) / 100 : 0;
    const notesRaw = line.notes;
    const movRaw = line.cashMovementId;
    const cashMovementId =
      typeof movRaw === 'string' && movRaw.trim() !== '' ? movRaw.trim() : undefined;
    return {
      amount,
      notes:
        notesRaw != null && String(notesRaw).trim() !== ''
          ? String(notesRaw).trim()
          : null,
      referentialAccountId: rid,
      ...(cashMovementId ? { cashMovementId } : {}),
      referentialAccount: rid ? map!.get(rid) ?? null : null,
    };
  });
}

async function normalizeReconciliationExpenseDetailsInput(
  db: PrismaClient,
  raw: unknown,
): Promise<
  | { tag: 'omit' }
  | { tag: 'clear' }
  | {
      tag: 'lines';
      lines: ReconciliationExpenseLineStored[];
      sum: number;
    }
> {
  if (raw === undefined) return { tag: 'omit' };
  if (raw === null) return { tag: 'clear' };
  if (!Array.isArray(raw)) {
    throw new BadRequestException('reconciliationExpenseDetails deve ser uma lista ou null para limpar.');
  }
  if (raw.length === 0) return { tag: 'clear' };

  type LineIn = {
    amount?: number | string;
    notes?: unknown;
    referentialAccountId?: unknown;
    cashMovementId?: unknown;
  };

  const out: ReconciliationExpenseLineStored[] = [];
  let sum = 0;
  for (const item of raw as LineIn[]) {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException('Cada linha de despesa deve ser um objeto.');
    }
    const amt =
      typeof item.amount === 'number'
        ? item.amount
        : parseFloat(String(item.amount ?? '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new BadRequestException('Cada linha de despesa precisa de valor maior que zero.');
    }
    const refId =
      item.referentialAccountId != null && String(item.referentialAccountId).trim() !== ''
        ? String(item.referentialAccountId).trim()
        : null;
    if (!refId) {
      throw new BadRequestException('Cada linha de despesa exige centro de custo.');
    }
    const acc = await db.referentialAccount.findUnique({ where: { id: refId } });
    if (!acc) {
      throw new BadRequestException('Centro de custo não encontrado para uma linha de despesa.');
    }
    if (!referentialCodeMatchesFlow(acc.code, 'OUT')) {
      throw new BadRequestException(
        'Centro de custo nas despesas deve ser conta do grupo 4 (custos) ou 5 (despesas).',
      );
    }
    const notesRaw = item.notes;
    const notes =
      notesRaw != null && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;
    const movRaw = item.cashMovementId;
    const cashMovementId =
      typeof movRaw === 'string' && movRaw.trim() !== '' ? movRaw.trim() : undefined;
    const rounded = Math.round(amt * 100) / 100;
    sum += rounded;
    out.push({
      amount: rounded,
      notes,
      referentialAccountId: refId,
      ...(cashMovementId ? { cashMovementId } : {}),
    });
  }

  return { tag: 'lines', lines: out, sum: Math.round(sum * 100) / 100 };
}

@Controller('cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Caixa aberto do operador logado. Mantido por compatibilidade — Caixa só
   * pode operar a sua própria sessão.
   */
  @Get('session')
  @Roles('admin', 'manager', 'seller')
  async currentSession(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
      include: { movements: { orderBy: { createdAt: 'desc' } } },
    });
  }

  /**
   * PDV / abertura de caixa: última venda do operador deve estar sem erro de
   * integração fiscal (`Sale.fiscalIntegrationError`).
   */
  @Get('pdv-readiness')
  @Roles('admin', 'manager', 'seller')
  async pdvReadiness(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const company = await db.company.findFirst({
      select: { pdvDocumentMode: true },
    });
    const last = await db.sale.findFirst({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        id: true,
        fiscalIntegrationError: true,
        createdAt: true,
      },
    });
    const err = last?.fiscalIntegrationError?.trim();
    const allowed = !err;
    return {
      pdvDocumentMode: company?.pdvDocumentMode ?? 'NON_FISCAL_RECEIPT',
      lastSale: last
        ? {
            id: last.id,
            number: last.number,
            fiscalIntegrationError: last.fiscalIntegrationError,
            createdAt: last.createdAt.toISOString(),
          }
        : null,
      allowed,
      blockReason: allowed ? null : `Última venda #${last!.number}: ${err}`,
    };
  }

  /**
   * Lista de sessões de caixa.
   *  - Gerentes/admin enxergam todas as sessões (paginadas implícita por filtros).
   *  - Caixa só vê as próprias sessões.
   * Suporta `status=OPEN|CLOSED` e `userId=…` na query string para filtragem.
   */
  @Get('sessions')
  @Roles('admin', 'manager', 'seller', 'finance')
  async listSessions(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');
    const where: Record<string, unknown> = {};
    if (status === 'OPEN') where.status = CashSessionStatus.OPEN;
    if (status === 'CLOSED') where.status = CashSessionStatus.CLOSED;
    // Caixa só pode ver as próprias sessões; gerente pode filtrar por userId.
    if (!isManager) {
      where.userId = user.sub;
    } else if (userId) {
      where.userId = userId;
    }

    const sessions = await db.cashRegisterSession.findMany({
      where,
      // Lista por ordem cronológica natural: mais antigo no topo.
      // Caixas abertos aparecem no fim apenas se forem os mais recentes.
      orderBy: { openedAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        reconciledBy: { select: { id: true, name: true, email: true } },
        movements: { select: { type: true, amount: true, method: true } },
      },
      take: 200,
    });

    const now = new Date();
    const saleWindowUserIds = [...new Set(sessions.map((s) => s.userId))];

    /** Uma única consulta para vendas de todos os caixas listados (janelas filtradas em memória). */
    let batchSales: Array<{
      userId: string | null;
      createdAt: Date;
      status: SaleStatus;
      total: unknown;
      payments: Array<{ method: string; amount: unknown }>;
    }> = [];
    if (sessions.length && saleWindowUserIds.length > 0) {
      let minOpened = sessions[0].openedAt;
      let maxEnd = now;
      for (const s of sessions) {
        if (s.openedAt < minOpened) minOpened = s.openedAt;
        const end = s.closedAt ?? now;
        if (end > maxEnd) maxEnd = end;
      }
      batchSales = await db.sale.findMany({
        where: {
          userId: { in: saleWindowUserIds },
          createdAt: { gte: minOpened, lte: maxEnd },
        },
        select: {
          userId: true,
          createdAt: true,
          status: true,
          total: true,
          payments: { select: { method: true, amount: true } },
        },
      });
    }

    const salesByUserId = new Map<string, typeof batchSales>();
    for (const sale of batchSales) {
      const uid = sale.userId;
      if (!uid) continue;
      const bucket = salesByUserId.get(uid);
      if (bucket) bucket.push(sale);
      else salesByUserId.set(uid, [sale]);
    }

    // Calcula totais leves (entradas/saídas) + vendas/conferência no servidor.
    return sessions.map((s) => {
      let movIn = 0;
      let movOut = 0;
      for (const m of s.movements) {
        const v = Number(m.amount);
        if (m.type === CashMovementType.IN) movIn += v;
        else movOut += v;
      }
      const upper = s.closedAt ?? now;
      const forUser = salesByUserId.get(s.userId) ?? [];
      const sessionSales = forUser.filter(
        (sale) =>
          sale.createdAt >= s.openedAt && sale.createdAt <= upper,
      );
      const { totalCompletedSales, reconciliationDifference } =
        computeSessionListAggregates({
          sales: sessionSales,
          movements: s.movements,
          openingBalance: s.openingBalance,
          closingByMethod: s.closingByMethod,
        });

      const { movements: _movements, ...rest } = s;
      return {
        ...rest,
        movementsIn: movIn,
        movementsOut: movOut,
        totalCompletedSales,
        reconciliationDifference,
      };
    });
  }

  /**
   * Relatório consolidado de caixas. Aceita dois modos de filtragem:
   *
   *  1) Por janela de tempo: `from` + `to` (default: hoje).
   *  2) Por intervalo de números de controle: `controlFrom` + `controlTo`.
   *
   * Filtros adicionais:
   *  - `userId`: restringe a um operador (gerentes apenas).
   *
   * Filtros combináveis: controle (`controlFrom`/`controlTo`), data (`from`/`to`),
   * `userId` e `status` (OPEN | CLOSED | RECONCILED | ALL).
   * Controles e datas só se combinam (AND) quando ambos forem enviados.
   * Sem data e com controle: retorna as sessões do intervalo de controle (janela inteira).
   * Sem controle e sem data: usa o dia atual como fallback.
   */
  @Get('report')
  @Roles('admin', 'manager', 'seller')
  async report(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('userId') userId?: string,
    @Query('controlFrom') controlFromRaw?: string,
    @Query('controlTo') controlToRaw?: string,
    /** OPEN | CLOSED | RECONCILED | ALL (padrão: todos) */
    @Query('status') statusRaw?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');

    // Parse dos controles (inteiros opcionais).
    const controlFrom = controlFromRaw ? parseInt(controlFromRaw, 10) : null;
    const controlTo = controlToRaw ? parseInt(controlToRaw, 10) : null;
    const useControlFilter =
      Number.isFinite(controlFrom as number) || Number.isFinite(controlTo as number);
    const useDateFilter = Boolean(fromRaw && toRaw);

    const from = fromRaw ? parseQueryDate(fromRaw, 'start') : startOfDay(new Date());
    const to = toRaw ? parseQueryDate(toRaw, 'end') : endOfDay(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }

    const status = (statusRaw ?? 'ALL').trim().toUpperCase();
    const where: Record<string, unknown> = {};
    if (useControlFilter) {
      const cn: Record<string, number> = {};
      if (Number.isFinite(controlFrom as number)) cn.gte = controlFrom as number;
      if (Number.isFinite(controlTo as number)) cn.lte = controlTo as number;
      where.controlNumber = cn;
    }
    // Janela de tempo: sessões que existiram dentro do range (combinável com controle).
    if (useDateFilter || !useControlFilter) {
      where.openedAt = { lte: to };
      where.AND = [
        {
          OR: [
            { closedAt: null },
            { closedAt: { gte: from } },
          ],
        },
      ];
    }
    if (status === 'OPEN') {
      where.status = CashSessionStatus.OPEN;
    } else if (status === 'CLOSED') {
      where.status = CashSessionStatus.CLOSED;
      where.reconciledAt = null;
    } else if (status === 'RECONCILED') {
      where.status = CashSessionStatus.CLOSED;
      where.reconciledAt = { not: null };
    }
    if (!isManager) where.userId = user.sub;
    else if (userId) where.userId = userId;

    const sessions = await db.cashRegisterSession.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        movements: true,
      },
      orderBy: { openedAt: 'asc' },
    });

    // Para cada sessão, busca vendas dentro da janela (uniformizado com sessionDetail).
    const detailed = await Promise.all(
      sessions.map(async (s) => {
        const upper = s.closedAt ?? new Date();
        /** Com data: interseção sessão ∩ [from,to]. Só controle: janela inteira da sessão. */
        const winStart =
          useDateFilter || !useControlFilter
            ? s.openedAt > from
              ? s.openedAt
              : from
            : s.openedAt;
        const winEnd =
          useDateFilter || !useControlFilter ? (upper < to ? upper : to) : upper;

        const sales = await db.sale.findMany({
          where: {
            userId: s.userId,
            createdAt: { gte: winStart, lte: winEnd },
          },
          include: {
            payments: true,
            items: { select: { quantity: true, discount: true } },
          },
        });

        let totalCompleted = 0;
        let totalCancelled = 0;
        let completedCount = 0;
        let cancelledCount = 0;
        let itemsCount = 0;
        let totalDiscounts = 0;
        let totalSurcharges = 0;

        for (const sale of sales) {
          const total = Number(sale.total);
          if (sale.status === SaleStatus.COMPLETED) {
            totalCompleted += total;
            completedCount += 1;
            totalDiscounts += Number(sale.discount);
            totalSurcharges += Number(sale.surcharge);
            for (const it of sale.items) {
              itemsCount += Number(it.quantity);
              totalDiscounts += Number(it.discount);
            }
          } else if (sale.status === SaleStatus.CANCELLED) {
            totalCancelled += total;
            cancelledCount += 1;
          }
        }

        const salesByMethod = buildSalesByMethod(sales);

        const { byMethod: expectedByMethodBase, movementBreakdown } = buildSessionExpectedByMethod(
          sales,
          s.movements,
        );

        let movIn = 0;
        let movOut = 0;
        for (const m of s.movements) {
          const v = Number(m.amount);
          if (m.type === CashMovementType.IN) movIn += v;
          else movOut += v;
        }

        const declaredNormalized = normalizeClosingByMethodInput(
          (s.closingByMethod ?? null) as Record<string, number | string> | null,
        );

        const opening = Number(s.openingBalance);

        const expectedByMethod = { ...expectedByMethodBase };
        if (expectedByMethod['CASH'] != null || opening > 0) {
          expectedByMethod['CASH'] = expectedFinalForMethodKey(
            'CASH',
            expectedByMethodBase,
            opening,
          );
        }

        const presentedTotal =
          declaredNormalized != null
            ? computeClosingBalanceFromDeclared(declaredNormalized)
            : s.closingBalance != null
              ? roundMoney(Number(s.closingBalance))
              : null;

        // Diferença por método.
        const diffByMethod: Record<string, number> | null = declaredNormalized
          ? Object.fromEntries(
              Array.from(
                new Set([
                  ...Object.keys(expectedByMethod),
                  ...Object.keys(declaredNormalized),
                ]),
              ).map((k) => [
                k,
                (declaredNormalized[k] ?? 0) - (expectedByMethod[k] ?? 0),
              ]),
            )
          : null;

        return {
          id: s.id,
          controlNumber: s.controlNumber,
          status: s.status,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          openingBalance: s.openingBalance,
          closingBalance: s.closingBalance,
          presentedTotal,
          closingNotes: s.closingNotes,
          reconciledAt: s.reconciledAt,
          user: s.user,
          movementsIn: movIn,
          movementsOut: movOut,
          movementBreakdown,
          completedCount,
          cancelledCount,
          itemsCount,
          totalCompleted,
          totalCancelled,
          totalDiscounts,
          totalSurcharges,
          salesByMethod,
          expectedByMethod,
          declaredByMethod: declaredNormalized,
          diffByMethod,
          reconciliationExpenseDetails: null as ReconciliationExpenseDetailOut[] | null,
          _rawReconciliationExpenseDetails: s.reconciliationExpenseDetails,
        };
      }),
    );

    const expenseAccountIds = [
      ...new Set(
        detailed.flatMap((row) => {
          const raw = row._rawReconciliationExpenseDetails;
          if (!Array.isArray(raw)) return [] as string[];
          const ids: string[] = [];
          for (const item of raw) {
            if (!isPlainObjectRecord(item)) continue;
            const ref = item.referentialAccountId;
            if (typeof ref === 'string' && ref.trim()) ids.push(ref.trim());
          }
          return ids;
        }),
      ),
    ];
    const expenseAccounts = expenseAccountIds.length
      ? await db.referentialAccount.findMany({
          where: { id: { in: expenseAccountIds } },
          select: { id: true, code: true, description: true },
        })
      : [];
    const expenseAccountMap = new Map(expenseAccounts.map((a) => [a.id, a]));

    const sessionsOut = await Promise.all(
      detailed.map(async (row) => {
        const { _rawReconciliationExpenseDetails, ...rest } = row;
        const reconciliationExpenseDetails =
          row.reconciledAt && _rawReconciliationExpenseDetails
            ? await enrichReconciliationExpenseDetails(
                db,
                _rawReconciliationExpenseDetails,
                expenseAccountMap,
              )
            : null;
        return { ...rest, reconciliationExpenseDetails };
      }),
    );

    // Totais consolidados.
    const totals = sessionsOut.reduce(
      (acc, s) => {
        acc.completedCount += s.completedCount;
        acc.cancelledCount += s.cancelledCount;
        acc.itemsCount += s.itemsCount;
        acc.totalCompleted += s.totalCompleted;
        acc.totalCancelled += s.totalCancelled;
        acc.totalDiscounts += s.totalDiscounts;
        acc.totalSurcharges += s.totalSurcharges;
        acc.openingBalance += Number(s.openingBalance);
        if (s.presentedTotal != null) acc.presentedTotal += s.presentedTotal;
        acc.movementsIn += s.movementsIn;
        acc.movementsOut += s.movementsOut;
        acc.movementBreakdown.suprimentos += s.movementBreakdown.suprimentos;
        acc.movementBreakdown.sangrias += s.movementBreakdown.sangrias;
        acc.movementBreakdown.despesas += s.movementBreakdown.despesas;
        for (const [k, v] of Object.entries(s.salesByMethod)) {
          acc.salesByMethod[k] = (acc.salesByMethod[k] ?? 0) + (v as number);
        }
        for (const [k, v] of Object.entries(s.expectedByMethod)) {
          acc.expectedByMethod[k] = (acc.expectedByMethod[k] ?? 0) + (v as number);
        }
        if (s.declaredByMethod) {
          for (const [k, v] of Object.entries(s.declaredByMethod)) {
            acc.declaredByMethod[k] = (acc.declaredByMethod[k] ?? 0) + v;
          }
        }
        return acc;
      },
      {
        completedCount: 0,
        cancelledCount: 0,
        itemsCount: 0,
        totalCompleted: 0,
        totalCancelled: 0,
        totalDiscounts: 0,
        totalSurcharges: 0,
        openingBalance: 0,
        presentedTotal: 0,
        movementsIn: 0,
        movementsOut: 0,
        movementBreakdown: { suprimentos: 0, sangrias: 0, despesas: 0 },
        salesByMethod: {} as Record<string, number>,
        expectedByMethod: {} as Record<string, number>,
        declaredByMethod: {} as Record<string, number>,
      },
    );

    totals.movementBreakdown.suprimentos = roundMoney(totals.movementBreakdown.suprimentos);
    totals.movementBreakdown.sangrias = roundMoney(totals.movementBreakdown.sangrias);
    totals.movementBreakdown.despesas = roundMoney(totals.movementBreakdown.despesas);
    totals.presentedTotal = roundMoney(totals.presentedTotal);

    let reportFrom = from;
    let reportTo = to;
    if (useControlFilter && sessionsOut.length > 0) {
      reportFrom = sessionsOut.reduce(
        (min, s) => (s.openedAt < min ? s.openedAt : min),
        sessionsOut[0].openedAt,
      );
      reportTo = sessionsOut.reduce((max, s) => {
        const end = s.closedAt ?? new Date();
        return end > max ? end : max;
      }, sessionsOut[0].closedAt ?? new Date());
    }

    return {
      from: reportFrom,
      to: reportTo,
      sessions: sessionsOut,
      totals: {
        ...totals,
        /** Alias legado — soma dos apresentados por rubrica (pós-conferência quando gravado). */
        closingBalance: totals.presentedTotal,
      },
    };
  }

  /**
   * Retorna o intervalo atual de números de controle (mínimo e máximo).
   * Usado pelo frontend para pré-preencher o filtro "Controle" na impressão.
   */
  @Get('control-range')
  @Roles('admin', 'manager', 'seller')
  async controlRange(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');
    const where: Record<string, unknown> = {};
    if (!isManager) where.userId = user.sub;

    const [min, max, count] = await Promise.all([
      db.cashRegisterSession.findFirst({
        where,
        orderBy: { controlNumber: 'asc' },
        select: { controlNumber: true },
      }),
      db.cashRegisterSession.findFirst({
        where,
        orderBy: { controlNumber: 'desc' },
        select: { controlNumber: true },
      }),
      db.cashRegisterSession.count({ where }),
    ]);

    return {
      min: min?.controlNumber ?? null,
      max: max?.controlNumber ?? null,
      count,
    };
  }

  /**
   * Relatório detalhado de itens vendidos em um período.
   *
   *  - Caixa (`seller`): vê apenas seus próprios itens.
   *  - Gerente/admin: vê todos; pode filtrar por `userId`.
   *
   * Aceita janela `from`/`to`, opcionalmente `controlFrom`/`controlTo` (vendas
   * dentro das sessões de caixa com esses controles) e `userId` / `status`.
   */
  @Get('report/items')
  @Roles('admin', 'manager', 'seller')
  async reportItems(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('controlFrom') controlFromRaw?: string,
    @Query('controlTo') controlToRaw?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');

    const controlFrom = controlFromRaw ? parseInt(controlFromRaw, 10) : null;
    const controlTo = controlToRaw ? parseInt(controlToRaw, 10) : null;
    const useControlFilter =
      Number.isFinite(controlFrom as number) || Number.isFinite(controlTo as number);

    const from = fromRaw ? parseQueryDate(fromRaw, 'start') : startOfDay(new Date());
    const to = toRaw ? parseQueryDate(toRaw, 'end') : endOfDay(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }

    const saleWhere: Record<string, unknown> = {};
    // Status — por padrão, apenas vendas concluídas; aceita ALL para incluir canceladas.
    if (!status || status === 'COMPLETED') saleWhere.status = SaleStatus.COMPLETED;
    else if (status === 'CANCELLED') saleWhere.status = SaleStatus.CANCELLED;

    // Restrição por operador.
    if (!isManager) saleWhere.userId = user.sub;
    else if (userId) saleWhere.userId = userId;

    if (useControlFilter) {
      const cn: Record<string, number> = {};
      if (Number.isFinite(controlFrom as number)) cn.gte = controlFrom as number;
      if (Number.isFinite(controlTo as number)) cn.lte = controlTo as number;
      const sessionWhere: Record<string, unknown> = { controlNumber: cn };
      if (!isManager) sessionWhere.userId = user.sub;
      else if (userId) sessionWhere.userId = userId;
      if (fromRaw && toRaw) {
        sessionWhere.openedAt = { lte: to };
        sessionWhere.AND = [
          { OR: [{ closedAt: null }, { closedAt: { gte: from } }] },
        ];
      }
      const sessions = await db.cashRegisterSession.findMany({
        where: sessionWhere,
        select: { userId: true, openedAt: true, closedAt: true },
      });
      if (sessions.length === 0) {
        return {
          from,
          to,
          userId: userId ?? null,
          status: status ?? 'COMPLETED',
          items: [],
          totals: {
            totalItems: 0,
            totalGross: 0,
            totalLineItemDiscount: 0,
            totalOrderDiscount: 0,
            totalSurcharges: 0,
            linesSubtotalBeforeOrderDiscount: 0,
            totalDiscount: 0,
            totalNet: 0,
            completedLineCount: 0,
            cancelledLineCount: 0,
          },
          byProduct: [],
          byUser: [],
        };
      }
      saleWhere.OR = sessions.map((s) => {
        const upper = s.closedAt ?? new Date();
        const winStart =
          fromRaw && toRaw ? (s.openedAt > from ? s.openedAt : from) : s.openedAt;
        const winEnd =
          fromRaw && toRaw ? (upper < to ? upper : to) : upper;
        return {
          userId: s.userId,
          createdAt: { gte: winStart, lte: winEnd },
        };
      });
    } else {
      saleWhere.createdAt = { gte: from, lte: to };
    }

    const sales = await db.sale.findMany({
      where: saleWhere,
      include: {
        user: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true } },
        payments: true,
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                barcode: true,
                product: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // "Achata" em linhas de item, mas preserva agrupamento por venda no front.
    const items = sales.flatMap((sale) =>
      sale.items.map((it) => ({
        saleId: sale.id,
        saleNumber: sale.number,
        saleStatus: sale.status,
        saleCreatedAt: sale.createdAt,
        saleTotal: sale.total,
        user: sale.user,
        customer: sale.customer,
        payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount })),
        itemId: it.id,
        productName: it.variant.product?.name ?? '(sem nome)',
        sku: it.variant.sku ?? null,
        barcode: it.variant.barcode ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
        totalLine: it.totalLine,
      })),
    );

    // Totais consolidados — descontos de linha e desconto no total do cupom (sale.discount).
    let linesSubtotalBeforeOrderDiscount = 0;
    const totalsFromItems = items.reduce(
      (acc, it) => {
        if (it.saleStatus === SaleStatus.COMPLETED) {
          acc.totalItems += Number(it.quantity);
          acc.totalGross += Number(it.unitPrice) * Number(it.quantity);
          acc.totalLineItemDiscount += Number(it.discount);
          linesSubtotalBeforeOrderDiscount += Number(it.totalLine);
          acc.completedLineCount += 1;
        } else if (it.saleStatus === SaleStatus.CANCELLED) {
          acc.cancelledLineCount += 1;
        }
        return acc;
      },
      {
        totalItems: 0,
        totalGross: 0,
        totalLineItemDiscount: 0,
        completedLineCount: 0,
        cancelledLineCount: 0,
      },
    );

    let totalOrderDiscount = 0;
    let totalSurcharges = 0;
    /** Soma dos totais efetivamente faturados (alinhado a `sale.total`). */
    let totalSalesNet = 0;
    for (const s of sales) {
      if (s.status !== SaleStatus.COMPLETED) continue;
      totalOrderDiscount += Number(s.discount);
      totalSurcharges += Number(s.surcharge);
      totalSalesNet += Number(s.total);
    }

    /** Descontos: linhas + desconto no cupom (não rateado pelas linhas no banco). */
    const totalDiscount =
      totalsFromItems.totalLineItemDiscount + totalOrderDiscount;

    const totals = {
      totalItems: totalsFromItems.totalItems,
      totalGross: totalsFromItems.totalGross,
      totalLineItemDiscount: totalsFromItems.totalLineItemDiscount,
      totalOrderDiscount,
      totalSurcharges,
      /** Soma útil para auditoria (subtotal antes do desconto do cupom). */
      linesSubtotalBeforeOrderDiscount,
      totalDiscount,
      /** Receita das vendas concluídas = somatório dos `sale.total`. */
      totalNet: totalSalesNet,
      completedLineCount: totalsFromItems.completedLineCount,
      cancelledLineCount: totalsFromItems.cancelledLineCount,
    };

    // Resumo por produto (vendas concluídas).
    const byProductMap = new Map<
      string,
      { name: string; sku: string | null; quantity: number; total: number }
    >();
    for (const it of items) {
      if (it.saleStatus !== SaleStatus.COMPLETED) continue;
      const key = it.productName + '|' + (it.sku ?? '');
      const cur = byProductMap.get(key);
      if (cur) {
        cur.quantity += Number(it.quantity);
        cur.total += Number(it.totalLine);
      } else {
        byProductMap.set(key, {
          name: it.productName,
          sku: it.sku,
          quantity: Number(it.quantity),
          total: Number(it.totalLine),
        });
      }
    }
    const byProduct = Array.from(byProductMap.values()).sort(
      (a, b) => b.quantity - a.quantity,
    );

    // Resumo por operador.
    const byUserMap = new Map<
      string,
      { name: string; email: string; quantity: number; total: number }
    >();
    for (const it of items) {
      if (it.saleStatus !== SaleStatus.COMPLETED) continue;
      const uid = it.user?.id ?? 'unknown';
      const cur = byUserMap.get(uid);
      if (cur) {
        cur.quantity += Number(it.quantity);
        cur.total += Number(it.totalLine);
      } else {
        byUserMap.set(uid, {
          name: it.user?.name ?? '—',
          email: it.user?.email ?? '',
          quantity: Number(it.quantity),
          total: Number(it.totalLine),
        });
      }
    }
    const byUser = Array.from(byUserMap.values()).sort((a, b) => b.total - a.total);

    return {
      from,
      to,
      userId: userId ?? null,
      status: status ?? 'COMPLETED',
      items,
      totals,
      byProduct,
      byUser,
    };
  }

  /**
   * Detalhe de uma sessão específica — incluindo vendas feitas durante a sua
   * janela de tempo (do mesmo operador) e os itens vendidos.
   *
   * Como o modelo Sale não tem uma FK direta para CashRegisterSession, a janela
   * é deduzida por `userId` e `createdAt ∈ [openedAt, closedAt ?? now]`.
   * Para garantir consistência futura recomenda-se uma migração adicionando
   * sessionId em Sale — fora do escopo desta tarefa.
   */
  @Get('sessions/:id')
  @Roles('admin', 'manager', 'seller')
  async sessionDetail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const session = await db.cashRegisterSession.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        reconciledBy: { select: { id: true, name: true, email: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          include: {
            referentialAccount: { select: { id: true, code: true, description: true } },
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada.');

    const isManager =
      user.roles.includes('admin') || user.roles.includes('manager');
    if (!isManager && session.userId !== user.sub) {
      throw new ForbiddenException('Sem permissão para visualizar este caixa.');
    }

    const upper = session.closedAt ?? new Date();
    const sales = await db.sale.findMany({
      where: {
        userId: session.userId,
        createdAt: { gte: session.openedAt, lte: upper },
      },
      include: {
        customer: { select: { id: true, name: true } },
        payments: {
          include: {
            paymentForm: { select: { id: true, name: true, kind: true, cardBrand: true } },
          },
        },
        items: {
          include: {
            variant: {
              select: {
                id: true,
                sku: true,
                barcode: true,
                retailPrice: true,
                product: { select: { name: true, description: true } },
              },
            },
          },
        },
      },
      // Detalhe da sessão lista vendas em ordem cronológica natural.
      orderBy: { createdAt: 'asc' },
    });

    let totalCompleted = 0;
    let totalCancelled = 0;
    let itemsCount = 0;
    let totalDiscounts = 0;
    let totalSurcharges = 0;
    for (const sale of sales) {
      const total = Number(sale.total);
      if (sale.status === SaleStatus.COMPLETED) {
        totalCompleted += total;
        totalDiscounts += Number(sale.discount);
        totalSurcharges += Number(sale.surcharge);
        for (const it of sale.items) {
          itemsCount += Number(it.quantity);
          totalDiscounts += Number(it.discount);
        }
      } else if (sale.status === SaleStatus.CANCELLED) {
        totalCancelled += total;
      }
    }

    const salesByMethod = buildSalesByMethod(sales);

    const salesByPaymentForm: Record<string, number> = {};
    const cardPayments: Array<{
      id: string;
      saleId: string;
      saleNumber: number;
      amount: number;
      installments: number;
      cardBrand: string | null;
      cardOperation: string | null;
      paymentFormId: string | null;
      paymentFormName: string | null;
      authCode: string | null;
      settlementStatus: string | null;
    }> = [];
    for (const sale of sales) {
      if (sale.status !== SaleStatus.COMPLETED) continue;
      for (const p of sale.payments) {
        const formKey = p.paymentForm?.name ?? p.method;
        salesByPaymentForm[formKey] =
          (salesByPaymentForm[formKey] ?? 0) + Number(p.amount);
        if (p.method === 'CARD') {
          cardPayments.push({
            id: p.id,
            saleId: sale.id,
            saleNumber: sale.number,
            amount: Number(p.amount),
            installments: p.installments,
            cardBrand: p.cardBrand,
            cardOperation: p.cardOperation,
            paymentFormId: p.paymentFormId,
            paymentFormName: p.paymentForm?.name ?? null,
            authCode: p.authCode,
            settlementStatus: p.settlementStatus,
          });
        }
      }
    }

    const { byMethod, movementBreakdown } = buildSessionExpectedByMethod(
      sales,
      session.movements,
    );

    /** Enriquece linhas gravadas na conferência com código/descrição do plano referencial (só resposta GET). */
    const reconciliationExpenseDetailsOut = await enrichReconciliationExpenseDetails(
      db,
      session.reconciliationExpenseDetails,
    );

    const sessionResponse = {
      ...session,
      reconciliationExpenseDetails: reconciliationExpenseDetailsOut,
    };

    return {
      session: sessionResponse,
      sales,
      summary: {
        completedCount: sales.filter((s) => s.status === SaleStatus.COMPLETED).length,
        cancelledCount: sales.filter((s) => s.status === SaleStatus.CANCELLED).length,
        totalCompleted,
        totalCancelled,
        itemsCount,
        totalDiscounts,
        totalSurcharges,
        salesByMethod,
        salesByPaymentForm,
        cardPayments,
        byMethod,
        movementBreakdown,
      },
    };
  }

  /**
   * Gerente/admin: ajusta os valores apresentados no fechamento (conferência
   * fisicamente o que foi contado). Recalcula `closingBalance` como a soma
   * dos meios de recebimento (exclui despesas analíticas).
   */
  @Patch('sessions/:id/declared-amounts')
  @Roles('admin', 'manager')
  async patchDeclaredAmounts(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      closingByMethod: Record<string, number | string>;
      reconciliationExpenseDetails?: unknown;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const session = await db.cashRegisterSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Sessão não encontrada.');
    if (session.status !== CashSessionStatus.CLOSED) {
      throw new BadRequestException('Só é possível ajustar apresentados em caixa já fechado.');
    }
    if (session.reconciledAt) {
      throw new BadRequestException(
        'Caixa já conferido. Reabra a conferência antes de alterar os valores.',
      );
    }

    const expenseInterpret = await normalizeReconciliationExpenseDetailsInput(
      db,
      body.reconciliationExpenseDetails,
    );

    let normalized = { ...(normalizeClosingByMethodInput(body.closingByMethod) ?? {}) };
    let reconciliationExpenseDetailsUpdate:
      | ReconciliationExpenseLineStored[]
      | typeof Prisma.DbNull
      | undefined;

    if (expenseInterpret.tag === 'lines') {
      const synced = await syncReconciliationExpenseMovements(
        db,
        id,
        expenseInterpret.lines,
        session.reconciliationExpenseDetails,
      );
      normalized = { ...normalized, EXPENSE: synced.sum };
      reconciliationExpenseDetailsUpdate = synced.lines;
    } else if (expenseInterpret.tag === 'clear') {
      await clearReconciliationExpenseMovements(db, id, session.reconciliationExpenseDetails);
      reconciliationExpenseDetailsUpdate = Prisma.DbNull;
    }

    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException(
        'Informe closingByMethod com ao menos um valor válido ou linhas detalhadas de despesa.',
      );
    }

    const total = computeClosingBalanceFromDeclared(normalized);

    return db.cashRegisterSession.update({
      where: { id },
      data: {
        closingByMethod: normalized,
        closingBalance: String(total.toFixed(2)),
        ...(reconciliationExpenseDetailsUpdate !== undefined
          ? { reconciliationExpenseDetails: reconciliationExpenseDetailsUpdate }
          : {}),
      },
    });
  }

  /**
   * Registra que o gerente concluiu a conferência deste caixa (audit trail).
   */
  @Post('sessions/:id/reconcile')
  @Roles('admin', 'manager')
  async reconcileSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { notes?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const session = await db.cashRegisterSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Sessão não encontrada.');
    if (session.status !== CashSessionStatus.CLOSED) {
      throw new BadRequestException('Só é possível conferir caixa fechado.');
    }
    if (session.reconciledAt) {
      throw new BadRequestException('Este caixa já foi conferido.');
    }
    return db.cashRegisterSession.update({
      where: { id },
      data: {
        reconciledAt: new Date(),
        reconciledByUserId: user.sub,
        reconciliationNotes:
          body.notes != null && String(body.notes).trim() !== ''
            ? String(body.notes).trim()
            : null,
      },
    });
  }

  /**
   * Desfaz a marcação de conferência para permitir correção dos apresentados.
   */
  @Post('sessions/:id/unreconcile')
  @Roles('admin', 'manager')
  async unreconcileSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const session = await db.cashRegisterSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Sessão não encontrada.');
    if (!session.reconciledAt) {
      throw new BadRequestException('Este caixa não está conferido.');
    }
    return db.cashRegisterSession.update({
      where: { id },
      data: {
        reconciledAt: null,
        reconciledByUserId: null,
        reconciliationNotes: null,
      },
    });
  }

  @Post('open')
  @Roles('admin', 'manager', 'seller')
  async open(@CurrentUser() user: JwtPayload, @Body() body: { openingBalance?: number }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    await assertLastSaleAllowsPdvEntry(db, user.sub);
    const existing = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (existing) {
      throw new BadRequestException('Já existe caixa aberto para este usuário');
    }
    const session = await db.cashRegisterSession.create({
      data: {
        userId: user.sub,
        openingBalance: String(body.openingBalance ?? 0),
      },
    });
    const fund = Number(body.openingBalance ?? 0);
    this.activityLog.record({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CASH_OPEN,
      summary: `Abriu caixa no PDV (fundo R$ ${fund.toFixed(2)})`,
      entityType: 'cash_session',
      entityRef: session.id,
    });
    return session;
  }

  @Post('close')
  @Roles('admin', 'manager', 'seller')
  async close(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      closingBalance: number;
      /**
       * Valores apresentados pelo operador no momento do fechamento, por
       * forma de pagamento (ex.: { CASH: 320.5, CARD: 150, PIX: 80, ... }).
       * Quando informado, é gravado em JSON na sessão e usado pelo gerente
       * para conciliar com o esperado a partir das vendas.
       */
      closingByMethod?: Record<string, number | string>;
      closingNotes?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const open = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (!open) throw new BadRequestException('Nenhum caixa aberto');

    // Saneamento do JSON de fechamento: aceita valores numéricos ou strings
    // que representem números, normaliza a vírgula como separador decimal e
    // descarta entradas inválidas (ex.: NaN, números negativos).
    const normalized = normalizeClosingByMethodInput(body.closingByMethod);
    const closingBalance =
      normalized != null
        ? computeClosingBalanceFromDeclared(normalized)
        : roundMoney(Number(body.closingBalance ?? 0));

    const updated = await db.cashRegisterSession.update({
      where: { id: open.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closingBalance: String(closingBalance.toFixed(2)),
        closingByMethod: normalized ?? undefined,
        closingNotes: body.closingNotes ?? null,
        closedAt: new Date(),
      },
    });
    this.activityLog.record({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      action: ActivityLogAction.CASH_CLOSE,
      summary: `Fechou caixa no PDV (R$ ${closingBalance.toFixed(2)})`,
      entityType: 'cash_session',
      entityRef: updated.id,
    });
    return updated;
  }

  @Post('movement')
  @Roles('admin', 'manager', 'seller')
  async movement(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      type: CashMovementType;
      amount: number;
      method?: PaymentMethod | null;
      reason?: string | null;
      referentialAccountId?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const open = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (!open) throw new BadRequestException('Abra o caixa antes');

    const method = body.method ?? null;
    if (body.type === CashMovementType.IN && method === PaymentMethod.EXPENSE) {
      throw new BadRequestException('Despesas só podem ser registradas como saída.');
    }

    let referentialAccountId: string | null =
      body.referentialAccountId != null && String(body.referentialAccountId).trim() !== ''
        ? String(body.referentialAccountId).trim()
        : null;

    if (referentialAccountId) {
      const acc = await db.referentialAccount.findUnique({
        where: { id: referentialAccountId },
      });
      if (!acc) {
        throw new BadRequestException('Centro de custo (plano referencial) não encontrado.');
      }
      if (body.type === CashMovementType.IN) {
        if (!referentialCodeMatchesFlow(acc.code, 'IN')) {
          throw new BadRequestException(
            'Para entradas (suprimento), o centro de custo deve ser conta de receita (grupo 6 do plano referencial).',
          );
        }
      } else if (body.type === CashMovementType.OUT) {
        if (method !== PaymentMethod.EXPENSE) {
          throw new BadRequestException(
            'Para usar centro de custo em saída, selecione o tipo “Despesas” (não sangria simples).',
          );
        }
        if (!referentialCodeMatchesFlow(acc.code, 'OUT')) {
          throw new BadRequestException(
            'O centro de custo deve ser conta do grupo 4 (custos) ou 5 (despesas).',
          );
        }
      }
    } else if (method === PaymentMethod.EXPENSE) {
      throw new BadRequestException('Despesas de caixa exigem centro de custo.');
    }

    return db.cashMovement.create({
      data: {
        sessionId: open.id,
        type: body.type,
        amount: String(body.amount),
        method,
        reason: body.reason ?? null,
        referentialAccountId,
      },
    });
  }
}
