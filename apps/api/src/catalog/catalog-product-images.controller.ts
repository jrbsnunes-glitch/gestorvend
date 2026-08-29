import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ProductImageStorage, type ProductImageSize } from './product-image.storage';

function parseSize(raw?: string): ProductImageSize {
  return raw === 'medium' ? 'medium' : 'thumb';
}

@Controller('catalog')
export class CatalogProductImagesController {
  constructor(
    private readonly images: ProductImageStorage,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Get(':tenantSlug/products/:productId/image')
  async publicImage(
    @Param('tenantSlug') tenantSlug: string,
    @Param('productId') productId: string,
    @Query('size') sizeRaw: string | undefined,
    @Res() res: Response,
  ) {
    const slug = tenantSlug.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/i.test(slug)) {
      throw new BadRequestException('Tenant inválido.');
    }
    const db = await this.tenantPrisma.getClient(slug);
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { hasImage: true },
    });
    if (!product?.hasImage) {
      throw new BadRequestException('Produto sem imagem.');
    }
    const size = parseSize(sizeRaw);
    const filePath = await this.images.resolveFile(slug, productId, size);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.sendFile(filePath);
  }
}
