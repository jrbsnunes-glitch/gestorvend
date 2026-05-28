import { BadRequestException, Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CompanyLogoStorage } from './company-logo.storage';

function assertSafeTenantSlug(tenantSlug: string): string {
  const slug = tenantSlug.trim();
  if (!/^[a-z0-9_-]+$/i.test(slug)) {
    throw new BadRequestException('Identificador de loja inválido.');
  }
  return slug;
}

/**
 * Arquivos de identidade visual por tenant — leitura pública para `<img src>`.
 * O slug do tenant já é conhecido no login; a logo não é dado sensível.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly logos: CompanyLogoStorage) {}

  @Get(':tenantSlug/logo')
  async logo(@Param('tenantSlug') tenantSlug: string, @Res() res: Response) {
    const slug = assertSafeTenantSlug(tenantSlug);
    const { filePath, mime } = await this.logos.resolveFile(slug);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(filePath);
  }
}
