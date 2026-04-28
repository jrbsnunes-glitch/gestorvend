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
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

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
        tradeName: body.tradeName ? String(body.tradeName) : null,
        document: body.document ? String(body.document) : null,
        email: body.email ? String(body.email) : null,
        phone: body.phone ? String(body.phone) : null,
        city: body.city ? String(body.city) : null,
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
        ...(body.tradeName !== undefined && { tradeName: body.tradeName ? String(body.tradeName) : null }),
        ...(body.document !== undefined && { document: body.document ? String(body.document) : null }),
        ...(body.email !== undefined && { email: body.email ? String(body.email) : null }),
        ...(body.phone !== undefined && { phone: body.phone ? String(body.phone) : null }),
        ...(body.city !== undefined && { city: body.city ? String(body.city) : null }),
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
