import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  BillStatus,
  CashSessionStatus,
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
function startOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Dashboard "do dono da loja": entrega TODAS as métricas em uma única
 * requisição para que o frontend faça apenas uma chamada e renderize
 * tudo de uma vez (UX rápida e baixa pressão sobre a API).
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('overview')
  @Roles('admin', 'manager', 'seller', 'finance')
  async overview(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);
    const last30Start = startOfDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const next7End = endOfDay(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

    const [
      salesToday,
      salesMonth,
      topItems,
      openSessions,
      payablesSoon,
      receivablesSoon,
    ] = await Promise.all([
      db.sale.findMany({
        where: {
          status: SaleStatus.COMPLETED,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        select: { total: true },
      }),
      db.sale.findMany({
        where: {
          status: SaleStatus.COMPLETED,
          createdAt: { gte: monthStart, lte: todayEnd },
        },
        select: { total: true },
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
        take: 5,
      }),
      db.cashRegisterSession.findMany({
        where: { status: CashSessionStatus.OPEN },
        orderBy: { openedAt: 'asc' },
        include: { user: { select: { name: true } } },
      }),
      db.accountPayable.findMany({
        where: {
          status: { in: [BillStatus.OPEN, BillStatus.OVERDUE] },
          // Títulos atrasados (qualquer data) ou com vencimento até o fim dos próximos 7 dias.
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
    ]);

    const sumTotals = (rows: Array<{ total: { toString(): string } }>) =>
      rows.reduce((acc, r) => acc + Number(r.total), 0);

    const revenueToday = sumTotals(salesToday);
    const revenueMonth = sumTotals(salesMonth);
    const countToday = salesToday.length;
    const countMonth = salesMonth.length;
    const avgTicketMonth = countMonth > 0 ? revenueMonth / countMonth : 0;

    // Carrega nomes/SKUs dos top 5 produtos em paralelo
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

    // Estoque crítico (produtos com saldo <= minStock).
    const lowStockVariants = await db.productVariant.findMany({
      where: { minStock: { gt: 0 } },
      include: {
        product: { select: { name: true } },
        stockBalances: { select: { quantity: true } },
      },
      take: 200,
    });
    const lowStock = lowStockVariants
      .map((v) => {
        const onHand = v.stockBalances.reduce((a, b) => a + Number(b.quantity), 0);
        return {
          variantId: v.id,
          sku: v.sku,
          productName: v.product.name,
          minStock: Number(v.minStock),
          onHand,
        };
      })
      .filter((row) => row.onHand <= row.minStock)
      .sort((a, b) => a.onHand - a.minStock - (b.onHand - b.minStock))
      .slice(0, 10);

    return {
      revenue: {
        today: revenueToday,
        month: revenueMonth,
      },
      sales: {
        today: countToday,
        month: countMonth,
        avgTicketMonth,
      },
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
}
