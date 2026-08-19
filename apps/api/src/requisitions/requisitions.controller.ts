import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MenuAccessService } from '../users/menu-access.service';
import {
  RequisitionsService,
  type RequisitionItemInput,
} from './requisitions.service';

/** Requisições (compra para pagar depois): vendas do PDV + lançamentos manuais. */
@Controller('requisitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RequisitionsController {
  constructor(
    private readonly requisitions: RequisitionsService,
    private readonly menuAccess: MenuAccessService,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
    @Query('take') take?: string,
  ) {
    return this.requisitions.list(user.tenantSlug, {
      status,
      from,
      to,
      customerId,
      take: take != null ? Number(take) : undefined,
    });
  }

  /** Caixas abertos para vincular o lançamento (gerente vê todos). */
  @Get('open-cash-sessions')
  @Roles('admin', 'manager', 'seller', 'finance')
  openCashSessions(@CurrentUser() user: JwtPayload) {
    return this.requisitions.openCashSessions(user.tenantSlug, {
      sub: user.sub,
      roles: user.roles,
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  detail(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.requisitions.detail(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      customerId: string;
      cashSessionId: string;
      installments?: number;
      notes?: string | null;
      items: RequisitionItemInput[];
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'requisitions',
      'create',
      body.managerPassword,
    );
    return this.requisitions.create(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      {
        customerId: body.customerId,
        cashSessionId: body.cashSessionId,
        installments: body.installments,
        notes: body.notes ?? null,
        items: body.items ?? [],
      },
    );
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: { permissionPassword?: string; managerPassword?: string } = {},
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'requisitions',
      'delete',
      body?.managerPassword,
    );
    return this.requisitions.cancel(
      user.tenantSlug,
      { sub: user.sub, roles: user.roles },
      id,
      body?.permissionPassword ?? body?.managerPassword,
    );
  }
}
