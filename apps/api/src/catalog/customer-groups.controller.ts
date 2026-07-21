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

@Controller('customer-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerGroupsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    await this.syncFromCustomerSegments(user.tenantSlug);
    const term = q?.trim();
    return db.customerGroup.findMany({
      where: term ? { name: { contains: term, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
      take: term ? 80 : 60,
    });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@CurrentUser() user: JwtPayload, @Body() body: { name?: string }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Informe o nome do grupo.');
    if (name.length > 120) throw new BadRequestException('Nome do grupo longo demais.');

    const existing = await db.customerGroup.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;

    return db.customerGroup.create({ data: { name } });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const name = body.name != null ? String(body.name).trim() : undefined;
    if (name !== undefined && !name) {
      throw new BadRequestException('Informe o nome do grupo.');
    }
    return db.customerGroup.update({
      where: { id },
      data: { ...(name != null && { name }) },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const group = await db.customerGroup.findUniqueOrThrow({ where: { id } });
    const inUse = await db.customer.count({
      where: { segment: { equals: group.name, mode: 'insensitive' } },
    });
    if (inUse > 0) {
      throw new BadRequestException('Grupo possui clientes vinculados');
    }
    await db.customerGroup.delete({ where: { id } });
    return { ok: true };
  }

  /** Garante que segmentos já gravados em Customer apareçam no catálogo. */
  private async syncFromCustomerSegments(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.customer.findMany({
      where: { segment: { not: null } },
      select: { segment: true },
      distinct: ['segment'],
    });
    for (const row of rows) {
      const name = row.segment?.trim();
      if (!name) continue;
      const exists = await db.customerGroup.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      if (!exists) {
        await db.customerGroup.create({ data: { name } });
      }
    }
  }
}
