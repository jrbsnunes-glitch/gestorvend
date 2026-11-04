import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SalesReservationsService } from '../sales-reservations/sales-reservations.service';

@Controller('pdv/drafts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PdvDraftsController {
  constructor(private readonly reservations: SalesReservationsService) {}

  @Get()
  @Roles('admin', 'manager', 'seller')
  list(@CurrentUser() user: JwtPayload) {
    return this.reservations.listPdvDrafts(user.tenantSlug, user.sub);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller')
  getOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reservations.getPdvDraft(user.tenantSlug, id, user.sub);
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      reservationId?: string | null;
      customerId?: string | null;
      pdvTerminalId?: string | null;
      pdvSellerUserId?: string | null;
      discount?: number;
      surcharge?: number;
      items: Array<{
        variantId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
        skipStock?: boolean;
      }>;
    },
  ) {
    return this.reservations.upsertPdvDraft({
      tenantSlug: user.tenantSlug,
      userId: user.sub,
      userRoles: user.roles,
      reservationId: body.reservationId,
      customerId: body.customerId,
      pdvTerminalId: body.pdvTerminalId,
      pdvSellerUserId: body.pdvSellerUserId,
      discount: body.discount,
      surcharge: body.surcharge,
      items: body.items ?? [],
    });
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reservations.cancelPdvDraft(user.tenantSlug, id, user.sub);
  }
}
