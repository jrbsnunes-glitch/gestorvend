import { BadRequestException, Injectable } from '@nestjs/common';
import { ManufacturingProjectSource } from '../generated/tenant-client';
import { ManufacturingService } from '../manufacturing/manufacturing.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type WaChatFactoryLeadInput = {
  tenantSlug: string;
  customerPhone: string;
  customerName?: string | null;
  finishedVariantId: string;
  quantity?: number | string;
  notes?: string | null;
  externalRef: string;
};

@Injectable()
export class WaChatFactoryService {
  constructor(
    private readonly manufacturing: ManufacturingService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async assertFactoryEnabled(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const co = await db.company.findFirst({ select: { factoryModuleEnabled: true } });
    if (!co?.factoryModuleEnabled) {
      throw new BadRequestException('Módulo Fábrica indisponível para este tenant.');
    }
  }

  /** Catálogo de PAs públicos — formato compacto para o bot. */
  async getCatalog(tenantSlug: string) {
    await this.assertFactoryEnabled(tenantSlug);
    const raw = await this.manufacturing.publicCatalog(tenantSlug);
    return {
      company: raw.company,
      products: raw.products
        .filter((p) => p.variant?.id)
        .map((p, index) => ({
          listIndex: index + 1,
          productId: p.id,
          name: p.name,
          description: p.description,
          controlNumber: p.controlNumber,
          category: p.category,
          leadTimeDays: p.leadTimeDays,
          hasImage: p.hasImage,
          imageVersion: p.imageVersion,
          variantId: p.variant!.id,
          sku: p.variant!.sku,
          retailPrice: p.variant!.retailPrice,
        })),
    };
  }

  async findLeadByExternalRef(tenantSlug: string, externalRef: string) {
    await this.assertFactoryEnabled(tenantSlug);
    const ref = externalRef.trim();
    if (!ref) throw new BadRequestException('Informe externalRef.');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const project = await db.manufacturingProject.findFirst({
      where: { externalRef: ref },
      select: {
        id: true,
        number: true,
        status: true,
        source: true,
        externalRef: true,
      },
    });
    if (!project) return null;
    return project;
  }

  /** Cria lead de fabricação (projeto) com idempotência por externalRef. */
  async createLead(input: WaChatFactoryLeadInput) {
    const tenantSlug = input.tenantSlug.trim();
    await this.assertFactoryEnabled(tenantSlug);

    const externalRef = input.externalRef?.trim();
    if (!externalRef) {
      throw new BadRequestException('externalRef é obrigatório para conciliação.');
    }

    const existing = await this.findLeadByExternalRef(tenantSlug, externalRef);
    if (existing) {
      return {
        projectId: existing.id,
        number: existing.number,
        status: existing.status,
        deduplicated: true,
      };
    }

    const phone = (input.customerPhone || '').replace(/\D/g, '');
    if (phone.length < 10) {
      throw new BadRequestException('Telefone do cliente inválido.');
    }

    const name = (input.customerName || '').trim() || `Cliente WhatsApp ${phone.slice(-4)}`;
    if (name.length < 2) {
      throw new BadRequestException('Informe o nome do cliente.');
    }

    const created = await this.manufacturing.createPublicLead(tenantSlug, {
      customerName: name,
      phone,
      finishedVariantId: input.finishedVariantId,
      quantity: input.quantity ?? 1,
      notes: input.notes?.trim() || null,
      source: ManufacturingProjectSource.WHATSAPP_LINK,
      externalRef,
      title: `Lead WhatsApp bot — ${name}`,
    });

    return {
      projectId: created.id,
      number: created.number,
      status: created.status,
      deduplicated: false,
    };
  }
}
