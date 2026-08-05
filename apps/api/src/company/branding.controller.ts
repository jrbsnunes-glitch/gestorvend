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
 * O query `?v=` (gerado no upload) só serve para invalidar cache do navegador.
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly logos: CompanyLogoStorage) {}

  @Get(':tenantSlug/logo')
  async logo(@Param('tenantSlug') tenantSlug: string, @Res() res: Response) {
    const slug = assertSafeTenantSlug(tenantSlug);
    const { filePath, mime } = await this.logos.resolveFile(slug);
    res.setHeader('Content-Type', mime);
    // URL já vem versionada (`?v=`); evita cache longo sem versão e permite
    // revalidação rápida quando o cliente ainda usa URL antiga.
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('ETag', `"${encodeURIComponent(filePath)}"`);
    res.sendFile(filePath);
  }
}
