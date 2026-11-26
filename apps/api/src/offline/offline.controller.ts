import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { OfflineCashBody, OfflineSaleBody, OfflineService } from './offline.service';

@Controller('offline')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Get('snapshot')
  @Roles('admin', 'manager', 'seller')
  snapshot(@CurrentUser() user: JwtPayload) {
    return this.offline.snapshot(user);
  }

  @Post('sales')
  @Roles('admin', 'manager', 'seller')
  sale(@CurrentUser() user: JwtPayload, @Body() body: OfflineSaleBody) {
    return this.offline.acceptSale(user, body);
  }

  @Post('cash-movements')
  @Roles('admin', 'manager', 'seller')
  cash(@CurrentUser() user: JwtPayload, @Body() body: OfflineCashBody) {
    return this.offline.acceptCash(user, body);
  }
}
