import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CardBrand,
  CardOperation,
  PaymentFormKind,
  Prisma,
} from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

const KINDS = new Set(Object.values(PaymentFormKind));
const BRANDS = new Set(Object.values(CardBrand));
const OPS = new Set(Object.values(CardOperation));

function decMoney(raw: unknown, label: string, allowZero = true): Prisma.Decimal {
  const n = Number(String(raw ?? '0').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw new BadRequestException(`${label} inválido.`);
  }
  return new Prisma.Decimal(n.toFixed(2));
}

function decPercent(raw: unknown, label: string): Prisma.Decimal {
  const n = Number(String(raw ?? '0').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new BadRequestException(`${label} deve ser entre 0 e 100.`);
  }
  return new Prisma.Decimal(n.toFixed(4));
}

@Controller('payment-forms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentFormsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('active') active?: string,
    @Query('kind') kind?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const where: Prisma.PaymentFormWhereInput = {};
    if (active === '1' || active === 'true') where.isActive = true;
    if (kind && KINDS.has(kind as PaymentFormKind)) {
      where.kind = kind as PaymentFormKind;
    }
    return db.paymentForm.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.paymentForm.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.paymentForm.create({ data: this.parseBody(body, true) as Prisma.PaymentFormCreateInput });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.paymentForm.update({
      where: { id },
      data: this.parseBody(body, false) as Prisma.PaymentFormUpdateInput,
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const inUse = await db.salePayment.count({ where: { paymentFormId: id } });
    if (inUse > 0) {
      await db.paymentForm.update({ where: { id }, data: { isActive: false } });
      return { ok: true, deactivated: true };
    }
    await db.paymentForm.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  private parseBody(body: Record<string, unknown>, requireName: boolean): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (body.name !== undefined || requireName) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('Informe o nome da forma de pagamento.');
      if (name.length > 120) throw new BadRequestException('Nome longo demais.');
      data.name = name;
    }
    if (body.kind !== undefined || requireName) {
      const kind = String(body.kind ?? '').toUpperCase();
      if (!KINDS.has(kind as PaymentFormKind)) {
        throw new BadRequestException('Tipo de forma de pagamento inválido.');
      }
      data.kind = kind as PaymentFormKind;
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) {
      const n = Number(body.sortOrder);
      data.sortOrder = Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    if (body.notes !== undefined) {
      data.notes = body.notes == null || String(body.notes).trim() === ''
        ? null
        : String(body.notes).trim();
    }

    const kind = (data.kind as PaymentFormKind | undefined) ?? (body.kind as PaymentFormKind | undefined);
    const isCard = kind === PaymentFormKind.CARD || String(body.kind).toUpperCase() === 'CARD';

    if (isCard) {
      if (body.cardBrand !== undefined || requireName) {
        const brand = String(body.cardBrand ?? '').toUpperCase();
        if (!BRANDS.has(brand as CardBrand)) {
          throw new BadRequestException('Selecione a bandeira do cartão.');
        }
        data.cardBrand = brand as CardBrand;
      }
      if (body.cardOperation !== undefined || requireName) {
        const op = String(body.cardOperation ?? '').toUpperCase();
        if (!OPS.has(op as CardOperation)) {
          throw new BadRequestException('Informe crédito ou débito.');
        }
        data.cardOperation = op as CardOperation;
      }
      if (body.adminFeePercent !== undefined || requireName) {
        data.adminFeePercent = decPercent(body.adminFeePercent ?? 0, 'Taxa administrativa %');
      }
      if (body.adminFeeFixed !== undefined || requireName) {
        data.adminFeeFixed = decMoney(body.adminFeeFixed ?? 0, 'Taxa fixa');
      }
      if (body.settlementDays !== undefined || requireName) {
        const d = Number(body.settlementDays ?? 1);
        if (!Number.isFinite(d) || d < 0 || d > 365) {
          throw new BadRequestException('Dias para baixa inválidos (0–365).');
        }
        data.settlementDays = Math.trunc(d);
      }
      if (body.maxInstallments !== undefined || requireName) {
        const m = Number(body.maxInstallments ?? 1);
        if (!Number.isFinite(m) || m < 1 || m > 48) {
          throw new BadRequestException('Parcelas máximas inválidas (1–48).');
        }
        data.maxInstallments = Math.trunc(m);
      }
    } else if (requireName || body.kind !== undefined) {
      data.cardBrand = null;
      data.cardOperation = null;
      data.adminFeePercent = new Prisma.Decimal(0);
      data.adminFeeFixed = new Prisma.Decimal(0);
      data.settlementDays = 0;
      data.maxInstallments = 1;
    }

    return data;
  }
}
