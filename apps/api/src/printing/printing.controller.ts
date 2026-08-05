import {
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
import { PrintJobStatus } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PrintingService } from './printing.service';

@Controller('printing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  @Get('stations')
  @Roles('admin', 'manager')
  listStations(@CurrentUser() user: JwtPayload) {
    return this.printing.listStations(user.tenantSlug);
  }

  @Post('stations')
  @Roles('admin', 'manager')
  createStation(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; sectors?: string[] | string },
  ) {
    return this.printing.createStation(user.tenantSlug, {
      name: body.name ?? '',
      sectors: body.sectors,
    });
  }

  @Patch('stations/:id')
  @Roles('admin', 'manager')
  updateStation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { name?: string; sectors?: string[] | string; enabled?: boolean },
  ) {
    return this.printing.updateStation(user.tenantSlug, id, body);
  }

  @Post('stations/:id/rotate-token')
  @Roles('admin', 'manager')
  rotateToken(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.printing.rotateStationToken(user.tenantSlug, id);
  }

  @Post('stations/:id/test')
  @Roles('admin', 'manager')
  testPrint(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.printing.enqueueTestJob(user.tenantSlug, id);
  }

  @Delete('stations/:id')
  @Roles('admin', 'manager')
  deleteStation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.printing.deleteStation(user.tenantSlug, id);
  }

  @Get('jobs')
  @Roles('admin', 'manager')
  listJobs(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    const statusEnum =
      status && Object.values(PrintJobStatus).includes(status as PrintJobStatus)
        ? (status as PrintJobStatus)
        : undefined;
    const n = take ? Number(take) : undefined;
    return this.printing.listJobs(user.tenantSlug, {
      status: statusEnum,
      take: Number.isFinite(n) ? n : undefined,
    });
  }

  @Post('jobs/:id/retry')
  @Roles('admin', 'manager')
  retry(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.printing.retryJob(user.tenantSlug, id);
  }
}
