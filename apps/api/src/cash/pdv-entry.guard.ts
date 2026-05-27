import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '../generated/tenant-client';

/**
 * Impede novo caixa/PDV se a última venda gravada pelo operador tiver erro de integração fiscal
 * pendente (`Sale.fiscalIntegrationError`).
 */
export async function assertLastSaleAllowsPdvEntry(
  db: PrismaClient,
  userId: string,
): Promise<void> {
  const last = await db.sale.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { number: true, fiscalIntegrationError: true },
  });
  const err = last?.fiscalIntegrationError?.trim();
  if (err && last) {
    throw new BadRequestException(
      `A última venda (#${last.number}) ficou com pendência fiscal ou de integração: ${err}. ` +
        `Resolva com o gerente (menu Vendas/caixa fiscal) antes de abrir novo caixa ou iniciar novo PDV.`,
    );
  }
}
