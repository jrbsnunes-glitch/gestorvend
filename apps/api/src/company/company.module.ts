import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { BrandingController } from './branding.controller';
import { CompanyLogoStorage } from './company-logo.storage';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [CompanyController, BrandingController],
  providers: [CompanyService, CompanyLogoStorage],
  exports: [CompanyService, CompanyLogoStorage],
})
export class CompanyModule {}
