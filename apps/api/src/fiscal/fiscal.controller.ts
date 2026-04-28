import { Controller, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';

/** Etapa 2 — NF-e / NFC-e / SPED. Desligado por padrão (`FISCAL_MODULE_ENABLED`). */
@Controller('fiscal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalController {
  constructor(private readonly config: ConfigService) {}

  @Get('status')
  @Roles('admin', 'manager')
  status() {
    const enabled = this.config.get<string>('FISCAL_MODULE_ENABLED') === 'true';
    if (!enabled) {
      throw new ServiceUnavailableException({
        message: 'Módulo fiscal desabilitado. Configure FISCAL_MODULE_ENABLED e homologação SEFAZ (Etapa 2).',
        enabled: false,
      });
    }
    return {
      enabled: true,
      note: 'Integração SEFAZ, certificado A1 e SPED serão implementados na Etapa 2.',
    };
  }
}
