import { Global, Module } from '@nestjs/common';
import { CentralPrismaService } from './central-prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  providers: [CentralPrismaService, TenantPrismaService],
  exports: [CentralPrismaService, TenantPrismaService],
})
export class PrismaModule {}
