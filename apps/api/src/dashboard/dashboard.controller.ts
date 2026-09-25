import { Controller, Get, Logger, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { RolesGuard } from '../auth/guards/roles.guard';

import { CurrentUser } from '../auth/current-user.decorator';

import { Roles } from '../auth/roles.decorator';

import { JwtPayload } from '../auth/strategies/jwt.strategy';

import {

  BillStatus,

  CashSessionStatus,

  PaymentMethod,

  SaleStatus,

} from '../generated/tenant-client';

import { TenantPrismaService } from '../prisma/tenant-prisma.service';

import {

  endOfDay,

  loadSalesTrendMonth,

  mergeSalesTrendAxis,

  startOfDay,

  startOfMonth,

} from './dashboard-sales-trend.util';



/** Teto do painel "Estoque crítico" (o card mostra 5; o "ver mais" abre o resto). */

const LOW_STOCK_LIMIT = 100;

/** Top produtos no card do Início (últimos 30 dias, por quantidade vendida). */

const TOP_PRODUCTS_LIMIT = 3;



/**

 * Dashboard "do dono da loja": entrega TODAS as métricas em uma única

 * requisição para que o frontend faça apenas uma chamada e renderize

 * tudo de uma vez (UX rápida e baixa pressão sobre a API).

 */

@Controller('dashboard')

@UseGuards(JwtAuthGuard, RolesGuard)

export class DashboardController {

  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private async salesTrendMonthPoints(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    monthStart: Date,
    todayEnd: Date,
    now: Date,
    tenantSlug: string,
  ) {
    try {
      return await loadSalesTrendMonth(db, monthStart, todayEnd, now);
    } catch (err) {
      this.logger.error(
        `Falha ao agregar a série diária de vendas (tenant ${tenantSlug}); gráfico do Início ficará zerado.`,
        err instanceof Error ? err.stack : String(err),
      );
      return mergeSalesTrendAxis(monthStart, now, new Map());
    }
  }



  private async buildOverview(user: JwtPayload) {

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    const now = new Date();

    const todayStart = startOfDay(now);

    const todayEnd = endOfDay(now);

    const monthStart = startOfMonth(now);

    const last30Start = startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

    const next7End = endOfDay(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));



    const [

      salesTodayAgg,

      salesMonthAgg,

      receivedTodayAgg,

      deferredTodayAgg,

      receivedMonthAgg,

      deferredMonthAgg,

      topItems,

      openSessions,

      payablesSoon,

      receivablesSoon,

      salesTrendMonth,

    ] = await Promise.all([

      db.sale.aggregate({

        where: {

          status: SaleStatus.COMPLETED,

          createdAt: { gte: todayStart, lte: todayEnd },

        },

        _sum: { total: true },

        _count: { _all: true },

      }),

      db.sale.aggregate({

        where: {

          status: SaleStatus.COMPLETED,

          createdAt: { gte: monthStart, lte: todayEnd },

        },

        _sum: { total: true },

        _count: { _all: true },

      }),

      db.salePayment.aggregate({

        where: {

          method: { notIn: [PaymentMethod.CREDIT, PaymentMethod.REQUISITION] },

          sale: {

            status: SaleStatus.COMPLETED,

            createdAt: { gte: todayStart, lte: todayEnd },

          },

        },

        _sum: { amount: true },

      }),

      db.salePayment.aggregate({

        where: {

          method: { in: [PaymentMethod.CREDIT, PaymentMethod.REQUISITION] },

          sale: {

            status: SaleStatus.COMPLETED,

            createdAt: { gte: todayStart, lte: todayEnd },

          },

        },

        _sum: { amount: true },

      }),

      db.salePayment.aggregate({

        where: {

          method: { notIn: [PaymentMethod.CREDIT, PaymentMethod.REQUISITION] },

          sale: {

            status: SaleStatus.COMPLETED,

            createdAt: { gte: monthStart, lte: todayEnd },

          },

        },

        _sum: { amount: true },

      }),

      db.salePayment.aggregate({

        where: {

          method: { in: [PaymentMethod.CREDIT, PaymentMethod.REQUISITION] },

          sale: {

            status: SaleStatus.COMPLETED,

            createdAt: { gte: monthStart, lte: todayEnd },

          },

        },

        _sum: { amount: true },

      }),

      db.saleItem.groupBy({

        by: ['variantId'],

        where: {

          sale: {

            status: SaleStatus.COMPLETED,

            createdAt: { gte: last30Start, lte: todayEnd },

          },

        },

        _sum: { quantity: true, totalLine: true },

        orderBy: { _sum: { quantity: 'desc' } },

        take: TOP_PRODUCTS_LIMIT,

      }),

      db.cashRegisterSession.findMany({

        where: { status: CashSessionStatus.OPEN },

        orderBy: { openedAt: 'asc' },

        include: { user: { select: { name: true } } },

      }),

      db.accountPayable.findMany({

        where: {

          status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },

          dueDate: { lte: next7End },

        },

        orderBy: { dueDate: 'asc' },

        include: { supplier: { select: { legalName: true } } },

        take: 10,

      }),

      db.accountReceivable.findMany({

        where: {

          status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },

          dueDate: { lte: next7End },

        },

        orderBy: { dueDate: 'asc' },

        include: { customer: { select: { name: true } } },

        take: 10,

      }),

      this.salesTrendMonthPoints(db, monthStart, todayEnd, now, user.tenantSlug),

    ]);



    const revenueToday = Number(salesTodayAgg._sum.total ?? 0);

    const revenueMonth = Number(salesMonthAgg._sum.total ?? 0);

    const receivedToday = Number(receivedTodayAgg._sum.amount ?? 0);

    const deferredToday = Number(deferredTodayAgg._sum.amount ?? 0);

    const receivedMonth = Number(receivedMonthAgg._sum.amount ?? 0);

    const deferredMonth = Number(deferredMonthAgg._sum.amount ?? 0);

    const countToday = salesTodayAgg._count._all;

    const countMonth = salesMonthAgg._count._all;

    const avgTicketMonth = countMonth > 0 ? revenueMonth / countMonth : 0;



    const topVariantIds = topItems.map((t) => t.variantId);

    const topVariants = topVariantIds.length

      ? await db.productVariant.findMany({

          where: { id: { in: topVariantIds } },

          select: {

            id: true,

            sku: true,

            product: { select: { name: true } },

          },

        })

      : [];

    const variantById = new Map(topVariants.map((v) => [v.id, v]));



    const topProducts = topItems.map((t) => {

      const v = variantById.get(t.variantId);

      return {

        variantId: t.variantId,

        sku: v?.sku ?? '—',

        productName: v?.product.name ?? 'Produto removido',

        quantity: Number(t._sum.quantity ?? 0),

        total: Number(t._sum.totalLine ?? 0),

      };

    });



    const [criticalCandidates, balanceTotals] = await Promise.all([

      db.productVariant.findMany({

        where: { minStock: { gt: 0 }, product: { isActive: true } },

        select: {

          id: true,

          sku: true,

          minStock: true,

          product: { select: { name: true, stockComponentVariantId: true } },

        },

      }),

      db.stockBalance.groupBy({ by: ['variantId'], _sum: { quantity: true } }),

    ]);

    const onHandByVariant = new Map(

      balanceTotals.map((b) => [b.variantId, Number(b._sum.quantity ?? 0)]),

    );

    const lowStock = criticalCandidates

      .map((v) => {

        const stockVariantId = v.product.stockComponentVariantId?.trim() || v.id;

        return {

          variantId: v.id,

          sku: v.sku,

          productName: v.product.name,

          minStock: Number(v.minStock),

          onHand: onHandByVariant.get(stockVariantId) ?? 0,

        };

      })

      .filter((row) => row.onHand <= row.minStock)

      .sort((a, b) => a.onHand - a.minStock - (b.onHand - b.minStock))

      .slice(0, LOW_STOCK_LIMIT);



    return {

      revenue: {

        today: revenueToday,

        month: revenueMonth,

        receivedToday,

        deferredToday,

        receivedMonth,

        deferredMonth,

      },

      sales: {

        today: countToday,

        month: countMonth,

        avgTicketMonth,

      },

      salesTrendMonth,

      topProducts,

      lowStock,

      openSessions: openSessions.map((s) => ({

        id: s.id,

        controlNumber: s.controlNumber,

        operator: s.user.name,

        openedAt: s.openedAt,

        openingBalance: Number(s.openingBalance),

      })),

      payablesSoon: payablesSoon.map((p) => ({

        id: p.id,

        description: p.description,

        status: p.status,

        amount: Number(p.amount),

        amountRemaining: Number(p.amountRemaining),

        dueDate: p.dueDate,

        supplier: p.supplier?.legalName ?? null,

      })),

      receivablesSoon: receivablesSoon.map((r) => ({

        id: r.id,

        description: r.description,

        status: r.status,

        amount: Number(r.amount),

        amountRemaining: Number(r.amountRemaining),

        dueDate: r.dueDate,

        customer: r.customer?.name ?? null,

      })),

    };

  }



  @Get('overview')

  @Roles('admin', 'manager', 'seller', 'finance')

  async overview(@CurrentUser() user: JwtPayload) {

    return this.buildOverview(user);

  }



  /** Série diária do mês (mesma lógica do overview — útil se o front precisar recarregar só o gráfico). */

  @Get('sales-trend-month')

  @Roles('admin', 'manager', 'seller', 'finance')

  async salesTrendMonth(@CurrentUser() user: JwtPayload) {

    const db = await this.tenantPrisma.getClient(user.tenantSlug);

    const now = new Date();

    const monthStart = startOfMonth(now);

    const todayEnd = endOfDay(now);

    const points = await this.salesTrendMonthPoints(
      db,
      monthStart,
      todayEnd,
      now,
      user.tenantSlug,
    );

    return { points };

  }

}


