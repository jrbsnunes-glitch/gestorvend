import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { BillStatus } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('finance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('payables')
  @Roles('admin', 'manager', 'finance')
  async payables(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountPayable.findMany({
      orderBy: { dueDate: 'asc' },
      include: { supplier: true },
    });
  }

  @Post('payables')
  @Roles('admin', 'manager', 'finance')
  async createPayable(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      supplierId?: string | null;
      description: string;
      category?: string | null;
      amount: number;
      dueDate: string;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountPayable.create({
      data: {
        supplierId: body.supplierId ?? null,
        description: body.description,
        category: body.category ?? null,
        amount: String(body.amount),
        dueDate: new Date(body.dueDate),
        status: BillStatus.OPEN,
      },
    });
  }

  @Patch('payables/:id/pay')
  @Roles('admin', 'manager', 'finance')
  async payPayable(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountPayable.update({
      where: { id },
      data: { status: BillStatus.PAID, paidAt: new Date() },
    });
  }

  @Get('receivables')
  @Roles('admin', 'manager', 'finance')
  async receivables(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountReceivable.findMany({
      orderBy: { dueDate: 'asc' },
      include: { customer: true, sale: true },
    });
  }

  @Patch('receivables/:id/receive')
  @Roles('admin', 'manager', 'finance')
  async receive(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.accountReceivable.update({
      where: { id },
      data: { status: BillStatus.PAID, receivedAt: new Date() },
    });
  }
}
