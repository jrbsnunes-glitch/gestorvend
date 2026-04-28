import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('stock-locations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LocationsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.stockLocation.findMany({ orderBy: { name: 'asc' } });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.stockLocation.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; name: string; isDefault?: boolean; parentId?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    if (body.isDefault) {
      await db.stockLocation.updateMany({ data: { isDefault: false } });
    }
    return db.stockLocation.create({
      data: {
        code: body.code,
        name: body.name,
        isDefault: Boolean(body.isDefault),
        parentId: body.parentId ?? null,
      },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; isDefault?: boolean; parentId?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    if (body.isDefault) {
      await db.stockLocation.updateMany({ data: { isDefault: false } });
    }
    return db.stockLocation.update({
      where: { id },
      data: {
        ...(body.name != null && { name: body.name }),
        ...(body.code != null && { code: body.code }),
        ...(body.isDefault != null && { isDefault: body.isDefault }),
        ...(body.parentId !== undefined && { parentId: body.parentId }),
      },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const mv = await db.stockMovement.count({ where: { locationId: id } });
    if (mv > 0) throw new BadRequestException('Local possui movimentações');
    const balances = await db.stockBalance.findMany({ where: { locationId: id } });
    if (balances.some((b) => Number(b.quantity) !== 0)) {
      throw new BadRequestException('Local possui saldo de estoque diferente de zero');
    }
    await db.stockBalance.deleteMany({ where: { locationId: id } });
    await db.stockLocation.delete({ where: { id } });
    return { ok: true };
  }
}
