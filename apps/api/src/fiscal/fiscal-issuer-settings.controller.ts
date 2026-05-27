import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { RolesGuard } from '../auth/guards/roles.guard';

import { Roles } from '../auth/roles.decorator';

import { CurrentUser } from '../auth/current-user.decorator';

import { JwtPayload } from '../auth/strategies/jwt.strategy';

import {

  FiscalIssuerEnvFallback,

  FiscalIssuerSettingsService,

} from './fiscal-issuer-settings.service';



@Controller('fiscal/issuer-settings')

@UseGuards(JwtAuthGuard, RolesGuard)

export class FiscalIssuerSettingsController {

  constructor(

    private readonly settings: FiscalIssuerSettingsService,

    private readonly config: ConfigService,

  ) {}



  private envFallback(): FiscalIssuerEnvFallback {

    const certPassword = this.config.get<string>('FISCAL_ISSUER_CERT_PASSWORD')?.trim() ?? '';

    const csc = this.config.get<string>('FISCAL_NFCE_CSC')?.trim() ?? '';

    return {

      certPath: this.config.get<string>('FISCAL_ISSUER_CERT_PATH'),

      certPasswordConfigured: Boolean(certPassword),

      cscId: this.config.get<string>('FISCAL_NFCE_CSC_ID'),

      cscSecretConfigured: Boolean(csc),

    };

  }



  @Get()

  @Roles('admin', 'manager')

  get(@CurrentUser() user: JwtPayload) {

    return this.settings.getPublic(user.tenantSlug, this.envFallback());

  }



  @Patch()

  @Roles('admin', 'manager')

  patch(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {

    return this.settings.patch(user.tenantSlug, body, this.envFallback());

  }

}

