import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.findMany({ orderBy: { name: 'asc' } });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.create({
      data: {
        name: String(body.name ?? ''),
        document: body.document ? String(body.document) : null,
        email: body.email ? String(body.email) : null,
        phone: body.phone ? String(body.phone) : null,
        creditLimit: body.creditLimit != null ? String(body.creditLimit) : '0',
        street: body.street ? String(body.street) : null,
        number: body.number ? String(body.number) : null,
        city: body.city ? String(body.city) : null,
        state: body.state ? String(body.state) : null,
        zip: body.zip ? String(body.zip) : null,
        segment: body.segment ? String(body.segment) : null,
      },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.update({
      where: { id },
      data: {
        ...(body.name != null && { name: String(body.name) }),
        ...(body.document !== undefined && { document: body.document ? String(body.document) : null }),
        ...(body.email !== undefined && { email: body.email ? String(body.email) : null }),
        ...(body.phone !== undefined && { phone: body.phone ? String(body.phone) : null }),
        ...(body.creditLimit != null && { creditLimit: String(body.creditLimit) }),
        ...(body.city !== undefined && { city: body.city ? String(body.city) : null }),
        ...(body.state !== undefined && { state: body.state ? String(body.state) : null }),
        ...(body.segment !== undefined && { segment: body.segment ? String(body.segment) : null }),
      },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const n = await db.sale.count({ where: { customerId: id } });
    if (n > 0) {
      throw new BadRequestException('Cliente possui vendas vinculadas');
    }
    const r = await db.accountReceivable.count({ where: { customerId: id } });
    if (r > 0) {
      throw new BadRequestException('Cliente possui títulos a receber');
    }
    await db.customer.delete({ where: { id } });
    return { ok: true };
  }
}
