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
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CompanyService } from './company.service';

const LOGO_UPLOAD_LIMIT = 2 * 1024 * 1024;

/**
 * CRUD do cadastro da empresa (singleton por tenant).
 *
 * - Qualquer usuário autenticado pode ler (usado por cabeçalhos de impressão).
 * - Apenas Gerente/admin pode atualizar.
 */
@Controller('company')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  get(@CurrentUser() user: JwtPayload) {
    return this.company.getOrCreate(user.tenantSlug);
  }

  @Patch()
  @Roles('admin', 'manager')
  update(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.company.update(user.tenantSlug, body);
  }

  /** Envia PNG/JPEG/WebP do computador; grava no servidor e atualiza `logoUrl`. */
  @Post('logo')
  @Roles('admin', 'manager')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: LOGO_UPLOAD_LIMIT },
    }),
  )
  uploadLogo(
    @CurrentUser() user: JwtPayload,
    @UploadedFile()
    file: { buffer: Buffer; mimetype?: string; size?: number } | undefined,
  ) {
    return this.company.uploadLogo(user.tenantSlug, file);
  }
}
