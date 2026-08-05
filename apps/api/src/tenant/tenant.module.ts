import { Module } from '@nestjs/common';
import { LicenseController } from './license.controller';
import { TenantService } from './tenant.service';

@Module({
  providers: [TenantService],
  controllers: [LicenseController],
  exports: [TenantService],
})
export class TenantModule {}
