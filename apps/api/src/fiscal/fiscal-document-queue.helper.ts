import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  PdvDocumentMode,
  PrismaClient,
} from '../generated/tenant-client';
import {
  loadSaleForFiscalValidation,
  validateSaleItemsForFiscalEmission,
} from './fiscal-emission-validation';

export async function upsertFiscalDocumentQueue(
  db: PrismaClient,
  saleId: string,
  kind: FiscalDocumentKind,
) {
  const sale = await loadSaleForFiscalValidation(db, saleId);
  validateSaleItemsForFiscalEmission(sale);

  return db.fiscalDocument.upsert({
    where: { saleId },
    create: {
      saleId,
      kind,
      status: FiscalDocumentStatus.QUEUED,
      lastError: null,
      nextAttemptAt: new Date(),
      tpEmis: 1,
    },
    update: {
      kind,
      status: FiscalDocumentStatus.QUEUED,
      lastError: null,
      nextAttemptAt: new Date(),
      accessKey: null,
      protocol: null,
      sefazEnvironment: null,
      tpEmis: 1,
      xmlPath: null,
      xmlSha256: null,
    },
  });
}

export async function maybeAutoQueueNfce(
  db: PrismaClient,
  company: {
    pdvDocumentMode: PdvDocumentMode;
    autoQueueNfceOnSale: boolean;
  } | null,
  saleId: string,
): Promise<void> {
  if (!company) return;
  if (company.pdvDocumentMode !== PdvDocumentMode.ELECTRONIC_FISCAL_PLANNED) return;
  if (!company.autoQueueNfceOnSale) return;
  try {
    await upsertFiscalDocumentQueue(db, saleId, FiscalDocumentKind.NFC_E);
  } catch {
    /* validação falhou — operador enfileira manualmente após corrigir cadastro */
  }
}
