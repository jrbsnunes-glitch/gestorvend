import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  FiscalIssuerEnvFallback,
  FiscalIssuerSettingsService,
} from './fiscal-issuer-settings.service';

const CERT_UPLOAD_LIMIT = 5 * 1024 * 1024;

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

  /** Envia .pfx/.p12 do computador; grava em pasta do tenant no servidor e atualiza o caminho. */
  @Post('certificate')
  @Roles('admin', 'manager')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CERT_UPLOAD_LIMIT },
    }),
  )
  uploadCertificate(
    @CurrentUser() user: JwtPayload,
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
    @Body('certificatePassword') certificatePassword?: string,
  ) {
    return this.settings.uploadCertificate(
      user.tenantSlug,
      file,
      certificatePassword,
      this.envFallback(),
    );
  }
}
