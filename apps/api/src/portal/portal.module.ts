import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalAuthController } from './portal-auth.controller';
import { PortalClientsController } from './portal-clients.controller';
import { TenantProvisioningService } from '../provisioning/tenant-provisioning.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    PrismaModule,
    TenantModule,
    ConfigModule,
    // O portal usa um segredo próprio para os tokens. Se `PORTAL_JWT_SECRET`
    // não estiver definido, caímos no segredo do app principal — útil em dev.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('PORTAL_JWT_SECRET') ??
          config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('PORTAL_JWT_EXPIRES') ?? '8h' },
      }),
    }),
  ],
  controllers: [PortalAuthController, PortalClientsController],
  providers: [PortalAuthGuard, TenantProvisioningService],
})
export class PortalModule {}
