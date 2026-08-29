import { BadRequestException } from '@nestjs/common';
import { PrismaClient, SaleStatus } from '../generated/tenant-client';

const INVALID_NCM = new Set(['00000000', '']);

export async function loadSaleForFiscalValidation(
  db: PrismaClient,
  saleId: string,
): Promise<{
  id: string;
  status: SaleStatus;
  number: number;
  items: Array<{
    variant: {
      sku: string;
      product: {
        name: string;
        ncm: string | null;
        fiscalSituationId: string | null;
        fiscalSituation: { id: string; csosn: string | null; cstIcms: string | null } | null;
      };
    };
  }>;
}> {
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                include: { fiscalSituation: true },
              },
            },
          },
        },
      },
    },
  });
  if (!sale) throw new BadRequestException('Venda não encontrada.');
  return sale;
}

export function validateSaleItemsForFiscalEmission(
  sale: Awaited<ReturnType<typeof loadSaleForFiscalValidation>>,
): void {
  if (sale.status !== SaleStatus.COMPLETED) {
    throw new BadRequestException('Só é possível emitir documento fiscal para venda concluída.');
  }
  if (!sale.items.length) {
    throw new BadRequestException('Venda sem itens — não é possível emitir documento fiscal.');
  }

  const missingNcm: string[] = [];
  const missingSituation: string[] = [];
  const missingTaxProfile: string[] = [];

  for (const it of sale.items) {
    const p = it.variant.product;
    const label = `${p.name} (${it.variant.sku})`;
    const ncm = (p.ncm ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8);
    if (!ncm || INVALID_NCM.has(ncm)) {
      missingNcm.push(label);
    }
    if (!p.fiscalSituationId || !p.fiscalSituation) {
      missingSituation.push(label);
      continue;
    }
    const fs = p.fiscalSituation;
    if (!fs.csosn?.trim() && !fs.cstIcms?.trim()) {
      missingTaxProfile.push(label);
    }
  }

  const parts: string[] = [];
  if (missingNcm.length) {
    parts.push(`NCM inválido ou ausente: ${missingNcm.slice(0, 5).join('; ')}${missingNcm.length > 5 ? '…' : ''}`);
  }
  if (missingSituation.length) {
    parts.push(
      `Situação fiscal não vinculada: ${missingSituation.slice(0, 5).join('; ')}${missingSituation.length > 5 ? '…' : ''}`,
    );
  }
  if (missingTaxProfile.length) {
    parts.push(
      `CSOSN ou CST ICMS ausente na situação fiscal: ${missingTaxProfile.slice(0, 5).join('; ')}${missingTaxProfile.length > 5 ? '…' : ''}`,
    );
  }
  if (parts.length) {
    throw new BadRequestException(
      `Cadastro fiscal incompleto para emissão (venda #${sale.number}). ${parts.join(' | ')}`,
    );
  }
}
