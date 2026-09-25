import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ManufacturingService } from './manufacturing.service';

/** Rotas públicas (sem JWT) — catálogo e leads. */
@Controller('manufacturing/public')
export class ManufacturingPublicController {
  constructor(private readonly manufacturing: ManufacturingService) {}

  @Get('catalog')
  catalog(@Query('tenantSlug') tenantSlug?: string) {
    if (!tenantSlug?.trim()) throw new BadRequestException('Informe tenantSlug');
    return this.manufacturing.publicCatalog(tenantSlug.trim());
  }

  @Post('leads')
  createLead(
    @Body()
    body: {
      tenantSlug: string;
      customerName: string;
      phone?: string | null;
      email?: string | null;
      finishedVariantId: string;
      quantity?: number | string;
      notes?: string | null;
      source?: string;
      externalRef?: string | null;
    },
  ) {
    if (!body?.tenantSlug?.trim()) throw new BadRequestException('Informe tenantSlug');
    return this.manufacturing.createPublicLead(body.tenantSlug.trim(), body);
  }
}
