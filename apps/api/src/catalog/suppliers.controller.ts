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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { validateCnpj14 } from '../common/cnpj.util';
import { validateCpf11 } from '../common/cpf.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function normalizeDocument(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11) {
    const cpf = validateCpf11(digits);
    if (!cpf.ok) throw new BadRequestException(cpf.reason);
    return cpf.cpf;
  }
  if (digits.length === 14) {
    const cnpj = validateCnpj14(digits);
    if (!cnpj.ok) throw new BadRequestException(cnpj.reason);
    return cnpj.cnpj;
  }
  throw new BadRequestException('Documento deve ser CPF (11) ou CNPJ (14 dígitos).');
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    return db.supplier.findMany({
      where: term
        ? {
            OR: [
              { legalName: { contains: term, mode: 'insensitive' } },
              { tradeName: { contains: term, mode: 'insensitive' } },
              { document: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { legalName: 'asc' },
      take: term ? 80 : undefined,
    });
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  async create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.supplier.create({
      data: {
        legalName: String(body.legalName ?? ''),
        tradeName: strOrNull(body.tradeName),
        document: normalizeDocument(body.document),
        email: strOrNull(body.email),
        phone: strOrNull(body.phone),
        street: strOrNull(body.street),
        number: strOrNull(body.number),
        complement: strOrNull(body.complement),
        district: strOrNull(body.district),
        city: strOrNull(body.city),
        state: strOrNull(body.state)?.toUpperCase().slice(0, 2) ?? null,
        zip: body.zip ? String(body.zip).replace(/\D/g, '').slice(0, 8) || null : null,
        segment: strOrNull(body.segment),
        notes: strOrNull(body.notes),
      },
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.supplier.findUniqueOrThrow({ where: { id } });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.supplier.update({
      where: { id },
      data: {
        ...(body.legalName != null && { legalName: String(body.legalName) }),
        ...(body.tradeName !== undefined && { tradeName: strOrNull(body.tradeName) }),
        ...(body.document !== undefined && { document: normalizeDocument(body.document) }),
        ...(body.email !== undefined && { email: strOrNull(body.email) }),
        ...(body.phone !== undefined && { phone: strOrNull(body.phone) }),
        ...(body.street !== undefined && { street: strOrNull(body.street) }),
        ...(body.number !== undefined && { number: strOrNull(body.number) }),
        ...(body.complement !== undefined && { complement: strOrNull(body.complement) }),
        ...(body.district !== undefined && { district: strOrNull(body.district) }),
        ...(body.city !== undefined && { city: strOrNull(body.city) }),
        ...(body.state !== undefined && {
          state: strOrNull(body.state)?.toUpperCase().slice(0, 2) ?? null,
        }),
        ...(body.zip !== undefined && {
          zip: body.zip ? String(body.zip).replace(/\D/g, '').slice(0, 8) || null : null,
        }),
        ...(body.segment !== undefined && { segment: strOrNull(body.segment) }),
        ...(body.notes !== undefined && { notes: strOrNull(body.notes) }),
      },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const p = await db.accountPayable.count({ where: { supplierId: id } });
    if (p > 0) throw new BadRequestException('Fornecedor possui contas a pagar');
    const g = await db.goodsReceipt.count({ where: { supplierId: id } });
    if (g > 0) throw new BadRequestException('Fornecedor possui entradas de mercadorias');
    await db.supplier.delete({ where: { id } });
    return { ok: true };
  }
}
