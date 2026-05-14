import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
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
  SaleStatus,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

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

@Controller('cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

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
   * Lista de sessões de caixa.
   *  - Gerentes/admin enxergam todas as sessões (paginadas implícita por filtros).
   *  - Caixa só vê as próprias sessões.
   * Suporta `status=OPEN|CLOSED` e `userId=…` na query string para filtragem.
   */
  @Get('sessions')
  @Roles('admin', 'manager', 'seller')
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
        movements: { select: { type: true, amount: true } },
      },
      take: 200,
    });

    // Calcula totais leves (entradas/saídas) no servidor para evitar trabalho no front.
    return sessions.map((s) => {
      let movIn = 0;
      let movOut = 0;
      for (const m of s.movements) {
        const v = Number(m.amount);
        if (m.type === CashMovementType.IN) movIn += v;
        else movOut += v;
      }
      const { movements: _movements, ...rest } = s;
      return { ...rest, movementsIn: movIn, movementsOut: movOut };
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
   * Regra: se `controlFrom`/`controlTo` forem informados, eles têm prioridade
   * sobre `from`/`to`. Caso contrário, vale a janela de tempo.
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
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');

    // Parse dos controles (inteiros opcionais).
    const controlFrom = controlFromRaw ? parseInt(controlFromRaw, 10) : null;
    const controlTo = controlToRaw ? parseInt(controlToRaw, 10) : null;
    const useControlFilter =
      Number.isFinite(controlFrom as number) || Number.isFinite(controlTo as number);

    const from = fromRaw ? parseQueryDate(fromRaw, 'start') : startOfDay(new Date());
    const to = toRaw ? parseQueryDate(toRaw, 'end') : endOfDay(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }

    const where: Record<string, unknown> = {};
    if (useControlFilter) {
      // Filtro por número de controle (inclusivo nos dois lados).
      const cn: Record<string, number> = {};
      if (Number.isFinite(controlFrom as number)) cn.gte = controlFrom as number;
      if (Number.isFinite(controlTo as number)) cn.lte = controlTo as number;
      where.controlNumber = cn;
    } else {
      // Janela de tempo: sessões que existiram dentro do range.
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
        const winStart = s.openedAt > from ? s.openedAt : from;
        const winEnd = upper < to ? upper : to;

        const sales = await db.sale.findMany({
          where: {
            userId: s.userId,
            createdAt: { gte: winStart, lte: winEnd },
          },
          include: {
            payments: true,
            items: { select: { quantity: true } },
          },
        });

        let totalCompleted = 0;
        let totalCancelled = 0;
        let completedCount = 0;
        let cancelledCount = 0;
        let itemsCount = 0;
        const byMethod = new Map<string, number>();

        for (const sale of sales) {
          const total = Number(sale.total);
          if (sale.status === SaleStatus.COMPLETED) {
            totalCompleted += total;
            completedCount += 1;
            for (const it of sale.items) itemsCount += Number(it.quantity);
            for (const p of sale.payments) {
              byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount));
            }
          } else if (sale.status === SaleStatus.CANCELLED) {
            totalCancelled += total;
            cancelledCount += 1;
          }
        }

        let movIn = 0;
        let movOut = 0;
        for (const m of s.movements) {
          const v = Number(m.amount);
          if (m.type === CashMovementType.IN) movIn += v;
          else movOut += v;
        }

        // Calcula diferenças quando o operador declarou closingByMethod.
        const declared = (s.closingByMethod ?? null) as
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

        const opening = Number(s.openingBalance);

        // Esperado por método (somando fundo de caixa apenas no CASH).
        const expectedByMethod = Object.fromEntries(byMethod);
        if (expectedByMethod['CASH'] != null || opening > 0) {
          expectedByMethod['CASH'] = (expectedByMethod['CASH'] ?? 0) + opening;
        }

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
          closingNotes: s.closingNotes,
          user: s.user,
          movementsIn: movIn,
          movementsOut: movOut,
          completedCount,
          cancelledCount,
          itemsCount,
          totalCompleted,
          totalCancelled,
          expectedByMethod,
          declaredByMethod: declaredNormalized,
          diffByMethod,
        };
      }),
    );

    // Totais consolidados.
    const totals = detailed.reduce(
      (acc, s) => {
        acc.completedCount += s.completedCount;
        acc.cancelledCount += s.cancelledCount;
        acc.itemsCount += s.itemsCount;
        acc.totalCompleted += s.totalCompleted;
        acc.totalCancelled += s.totalCancelled;
        acc.openingBalance += Number(s.openingBalance);
        acc.closingBalance += s.closingBalance ? Number(s.closingBalance) : 0;
        acc.movementsIn += s.movementsIn;
        acc.movementsOut += s.movementsOut;
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
        openingBalance: 0,
        closingBalance: 0,
        movementsIn: 0,
        movementsOut: 0,
        expectedByMethod: {} as Record<string, number>,
        declaredByMethod: {} as Record<string, number>,
      },
    );

    return {
      from,
      to,
      sessions: detailed,
      totals,
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
   * Aceita os mesmos parâmetros de janela do `/cash/report` (`from`/`to`).
   * Retorna a lista chã de itens (uma linha por SaleItem) com o contexto da
   * venda — útil para auditoria de "tudo o que saiu da loja" e para detalhar
   * um caixa específico (escolhendo operador + dia).
   */
  @Get('report/items')
  @Roles('admin', 'manager', 'seller')
  async reportItems(
    @CurrentUser() user: JwtPayload,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const isManager = user.roles.includes('admin') || user.roles.includes('manager');

    const from = fromRaw ? parseQueryDate(fromRaw, 'start') : startOfDay(new Date());
    const to = toRaw ? parseQueryDate(toRaw, 'end') : endOfDay(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Datas inválidas em "from"/"to".');
    }

    const saleWhere: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    // Status — por padrão, apenas vendas concluídas; aceita ALL para incluir canceladas.
    if (!status || status === 'COMPLETED') saleWhere.status = SaleStatus.COMPLETED;
    else if (status === 'CANCELLED') saleWhere.status = SaleStatus.CANCELLED;

    // Restrição por operador.
    if (!isManager) saleWhere.userId = user.sub;
    else if (userId) saleWhere.userId = userId;

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

    // Totais consolidados.
    const totals = items.reduce(
      (acc, it) => {
        if (it.saleStatus === SaleStatus.COMPLETED) {
          acc.totalItems += Number(it.quantity);
          acc.totalGross += Number(it.unitPrice) * Number(it.quantity);
          acc.totalDiscount += Number(it.discount);
          acc.totalNet += Number(it.totalLine);
          acc.completedLineCount += 1;
        } else if (it.saleStatus === SaleStatus.CANCELLED) {
          acc.cancelledLineCount += 1;
        }
        return acc;
      },
      {
        totalItems: 0,
        totalGross: 0,
        totalDiscount: 0,
        totalNet: 0,
        completedLineCount: 0,
        cancelledLineCount: 0,
      },
    );

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
        movements: { orderBy: { createdAt: 'desc' } },
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
        payments: true,
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
    const byMethod = new Map<string, number>();
    for (const sale of sales) {
      const total = Number(sale.total);
      if (sale.status === SaleStatus.COMPLETED) {
        totalCompleted += total;
        for (const it of sale.items) {
          itemsCount += Number(it.quantity);
        }
        for (const p of sale.payments) {
          const cur = byMethod.get(p.method) ?? 0;
          byMethod.set(p.method, cur + Number(p.amount));
        }
      } else if (sale.status === SaleStatus.CANCELLED) {
        totalCancelled += total;
      }
    }

    return {
      session,
      sales,
      summary: {
        completedCount: sales.filter((s) => s.status === SaleStatus.COMPLETED).length,
        cancelledCount: sales.filter((s) => s.status === SaleStatus.CANCELLED).length,
        totalCompleted,
        totalCancelled,
        itemsCount,
        byMethod: Object.fromEntries(byMethod),
      },
    };
  }

  @Post('open')
  @Roles('admin', 'manager', 'seller')
  async open(@CurrentUser() user: JwtPayload, @Body() body: { openingBalance?: number }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const existing = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (existing) {
      throw new BadRequestException('Já existe caixa aberto para este usuário');
    }
    return db.cashRegisterSession.create({
      data: {
        userId: user.sub,
        openingBalance: String(body.openingBalance ?? 0),
      },
    });
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
    let normalized: Record<string, number> | null = null;
    if (body.closingByMethod && typeof body.closingByMethod === 'object') {
      const acc: Record<string, number> = {};
      for (const [key, raw] of Object.entries(body.closingByMethod)) {
        const num =
          typeof raw === 'number'
            ? raw
            : parseFloat(String(raw ?? '').replace(',', '.'));
        if (Number.isFinite(num) && num >= 0) {
          acc[key] = Math.round(num * 100) / 100;
        }
      }
      normalized = Object.keys(acc).length > 0 ? acc : null;
    }

    return db.cashRegisterSession.update({
      where: { id: open.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closingBalance: String(body.closingBalance ?? 0),
        closingByMethod: normalized ?? undefined,
        closingNotes: body.closingNotes ?? null,
        closedAt: new Date(),
      },
    });
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
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const open = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (!open) throw new BadRequestException('Abra o caixa antes');
    return db.cashMovement.create({
      data: {
        sessionId: open.id,
        type: body.type,
        amount: String(body.amount),
        method: body.method ?? null,
        reason: body.reason ?? null,
      },
    });
  }
}
