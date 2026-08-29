import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SalesModule } from '../sales/sales.module';
import { PaymentsModule } from '../payments/payments.module';
import { CompanyModule } from '../company/company.module';
import { TenantModule } from '../tenant/tenant.module';
import { KioskController, PdvTerminalsController } from './pdv-terminals.controller';
import { PdvTerminalsService } from './pdv-terminals.service';

@Module({
  imports: [
    SalesModule,
    PaymentsModule,
    CompanyModule,
    TenantModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_ACCESS_EXPIRES') ?? '15m' },
      }),
    }),
  ],
  controllers: [PdvTerminalsController, KioskController],
  providers: [PdvTerminalsService],
  exports: [PdvTerminalsService],
})
export class PdvTerminalsModule {}
