import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CashMovementType, CashSessionStatus, PaymentMethod } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('cash')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('session')
  @Roles('admin', 'manager', 'seller')
  async currentSession(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
      include: { movements: { orderBy: { createdAt: 'desc' } } },
    });
  }

  @Post('open')
  @Roles('admin', 'manager', 'seller')
  async open(@CurrentUser() user: JwtPayload, @Body() body: { openingBalance?: number }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const existing = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (existing) {
      throw new BadRequestException('Já existe caixa aberto para este usuário');
    }
    return db.cashRegisterSession.create({
      data: {
        userId: user.sub,
        openingBalance: String(body.openingBalance ?? 0),
      },
    });
  }

  @Post('close')
  @Roles('admin', 'manager', 'seller')
  async close(@CurrentUser() user: JwtPayload, @Body() body: { closingBalance: number }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const open = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (!open) throw new BadRequestException('Nenhum caixa aberto');
    return db.cashRegisterSession.update({
      where: { id: open.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closingBalance: String(body.closingBalance),
        closedAt: new Date(),
      },
    });
  }

  @Post('movement')
  @Roles('admin', 'manager', 'seller')
  async movement(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      type: CashMovementType;
      amount: number;
      method?: PaymentMethod | null;
      reason?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const open = await db.cashRegisterSession.findFirst({
      where: { userId: user.sub, status: CashSessionStatus.OPEN },
    });
    if (!open) throw new BadRequestException('Abra o caixa antes');
    return db.cashMovement.create({
      data: {
        sessionId: open.id,
        type: body.type,
        amount: String(body.amount),
        method: body.method ?? null,
        reason: body.reason ?? null,
      },
    });
  }
}
