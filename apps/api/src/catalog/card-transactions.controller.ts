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
import {
  CardBrand,
  CardSettlementStatus,
  PaymentMethod,
  Prisma,
  SaleStatus,
} from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function parseDayStart(iso?: string): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(`${iso.trim()}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(iso?: string): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(`${iso.trim()}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Controller('card-transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CardTransactionsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('brand') brand?: string,
    @Query('settlement') settlement?: string,
    @Query('paymentFormId') paymentFormId?: string,
    @Query('cardOperation') cardOperation?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const from = parseDayStart(dateFrom);
    const to = parseDayEnd(dateTo);
    const where: Prisma.SalePaymentWhereInput = {
      method: PaymentMethod.CARD,
      sale: {
        status: SaleStatus.COMPLETED,
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
    };
    if (brand && Object.values(CardBrand).includes(brand as CardBrand)) {
      where.cardBrand = brand as CardBrand;
    }
    if (settlement === 'OPEN' || settlement === 'SETTLED') {
      where.settlementStatus = settlement as CardSettlementStatus;
    } else if (settlement === 'open') {
      where.settlementStatus = CardSettlementStatus.OPEN;
    } else if (settlement === 'settled' || settlement === 'baixados') {
      where.settlementStatus = CardSettlementStatus.SETTLED;
    } else if (settlement === 'abertos') {
      where.settlementStatus = CardSettlementStatus.OPEN;
    }
    if (paymentFormId?.trim()) where.paymentFormId = paymentFormId.trim();
    if (cardOperation === 'CREDIT' || cardOperation === 'DEBIT') {
      where.cardOperation = cardOperation;
    }

    const takeN = Math.min(Math.max(Number(take) || 30, 1), 500);
    const skipN = Math.max(Number(skip) || 0, 0);

    const [total, items] = await Promise.all([
      db.salePayment.count({ where }),
      db.salePayment.findMany({
        where,
        orderBy: [{ sale: { createdAt: 'desc' } }, { createdAt: 'desc' }],
        take: takeN,
        skip: skipN,
        include: {
          paymentForm: { select: { id: true, name: true } },
          sale: {
            select: {
              id: true,
              number: true,
              total: true,
              createdAt: true,
              customer: { select: { id: true, name: true } },
              user: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    return { total, items, take: takeN, skip: skipN };
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.salePayment.findFirst({
      where: { id, method: PaymentMethod.CARD },
      include: {
        paymentForm: true,
        sale: {
          include: {
            customer: true,
            user: { select: { id: true, name: true } },
            items: {
              include: { variant: { include: { product: { select: { name: true } } } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Transação de cartão não encontrada.');
    return row;
  }

  @Post(':id/settle')
  @Roles('admin', 'manager', 'finance')
  async settle(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.salePayment.findFirst({
      where: { id, method: PaymentMethod.CARD },
    });
    if (!row) throw new NotFoundException('Transação não encontrada.');
    return db.salePayment.update({
      where: { id },
      data: {
        settlementStatus: CardSettlementStatus.SETTLED,
        settledAt: new Date(),
      },
    });
  }

  @Post(':id/reopen')
  @Roles('admin', 'manager', 'finance')
  async reopen(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.salePayment.findFirst({
      where: { id, method: PaymentMethod.CARD },
    });
    if (!row) throw new NotFoundException('Transação não encontrada.');
    return db.salePayment.update({
      where: { id },
      data: {
        settlementStatus: CardSettlementStatus.OPEN,
        settledAt: null,
      },
    });
  }

  /** Corrige forma/valor/bandeira de um pagamento cartão (ex.: erro no caixa). */
  @Patch(':id')
  @Roles('admin', 'manager')
  async patch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      paymentFormId?: string;
      amount?: number | string;
      installments?: number;
      authCode?: string | null;
      cardBrand?: CardBrand;
      cardOperation?: 'CREDIT' | 'DEBIT';
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const row = await db.salePayment.findFirst({
      where: { id },
      include: { sale: { include: { payments: true } } },
    });
    if (!row) throw new NotFoundException('Pagamento não encontrado.');
    if (row.sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException('Só é possível editar pagamento de venda concluída.');
    }

    const data: Prisma.SalePaymentUpdateInput = {};
    let amount = Number(row.amount);

    if (body.paymentFormId) {
      const form = await db.paymentForm.findUnique({ where: { id: body.paymentFormId } });
      if (!form || form.kind !== 'CARD') {
        throw new BadRequestException('Selecione uma forma de pagamento do tipo cartão.');
      }
      data.paymentForm = { connect: { id: form.id } };
      data.method = PaymentMethod.CARD;
      data.cardBrand = form.cardBrand;
      data.cardOperation = form.cardOperation;
      const feePct = Number(form.adminFeePercent);
      const feeFix = Number(form.adminFeeFixed);
      const fee = Math.round((amount * feePct) / 100 * 100) / 100 + feeFix;
      data.adminFeeAmount = new Prisma.Decimal(fee.toFixed(2));
      data.netAmount = new Prisma.Decimal((amount - fee).toFixed(2));
      const days = form.settlementDays ?? 1;
      const expected = new Date();
      expected.setDate(expected.getDate() + days);
      data.expectedSettleAt = expected;
      if (!row.settlementStatus) data.settlementStatus = CardSettlementStatus.OPEN;
    }

    if (body.amount != null) {
      amount = Number(String(body.amount).replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Valor inválido.');
      }
      // Recalcula soma dos outros pagamentos da venda
      const others = row.sale.payments
        .filter((p) => p.id !== row.id)
        .reduce((s, p) => s + Number(p.amount), 0);
      const saleTotal = Number(row.sale.total);
      if (Math.abs(others + amount - saleTotal) > 0.02) {
        throw new BadRequestException(
          `A soma dos pagamentos deve continuar igual ao total da venda (${saleTotal.toFixed(2)}).`,
        );
      }
      data.amount = new Prisma.Decimal(amount.toFixed(2));
      const feePct = body.paymentFormId
        ? Number((await db.paymentForm.findUnique({ where: { id: body.paymentFormId } }))?.adminFeePercent ?? 0)
        : row.paymentFormId
          ? Number((await db.paymentForm.findUnique({ where: { id: row.paymentFormId } }))?.adminFeePercent ?? 0)
          : 0;
      const feeFix = body.paymentFormId
        ? Number((await db.paymentForm.findUnique({ where: { id: body.paymentFormId } }))?.adminFeeFixed ?? 0)
        : row.paymentFormId
          ? Number((await db.paymentForm.findUnique({ where: { id: row.paymentFormId } }))?.adminFeeFixed ?? 0)
          : 0;
      const fee = Math.round((amount * feePct) / 100 * 100) / 100 + feeFix;
      data.adminFeeAmount = new Prisma.Decimal(fee.toFixed(2));
      data.netAmount = new Prisma.Decimal((amount - fee).toFixed(2));
    }

    if (body.installments != null) {
      const inst = Math.max(1, Math.min(48, Math.trunc(Number(body.installments))));
      data.installments = inst;
    }
    if (body.authCode !== undefined) {
      data.authCode = body.authCode?.trim() ? String(body.authCode).trim().slice(0, 40) : null;
    }
    if (body.cardBrand && Object.values(CardBrand).includes(body.cardBrand)) {
      data.cardBrand = body.cardBrand;
    }
    if (body.cardOperation === 'CREDIT' || body.cardOperation === 'DEBIT') {
      data.cardOperation = body.cardOperation;
    }

    return db.salePayment.update({
      where: { id },
      data,
      include: { paymentForm: true, sale: { select: { id: true, number: true, total: true } } },
    });
  }
}
