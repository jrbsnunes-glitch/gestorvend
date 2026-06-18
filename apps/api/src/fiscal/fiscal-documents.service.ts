import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FiscalDocumentKind,
  FiscalDocumentStatus,
  PdvDocumentMode,
  SaleStatus,
  UserPermissionCode,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserPermissionsService } from '../users/user-permissions.service';

/**
 * Fila local de emissão por venda (próximo passo: worker com XML, certificado A1, SEFAZ).
 */
@Injectable()
export class FiscalDocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly userPermissions: UserPermissionsService,
  ) {}

  async queue(tenantSlug: string, saleId: string, kind: FiscalDocumentKind) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!company) {
      throw new BadRequestException('Empresa não configurada');
    }
    if (company.pdvDocumentMode !== PdvDocumentMode.ELECTRONIC_FISCAL_PLANNED) {
      throw new BadRequestException(
        'A empresa está em modo comprovante não fiscal. Em Cadastro da empresa, selecione documento fiscal planejado antes de enfileirar.',
      );
    }
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException('Só é possível enfileirar documento para venda concluída.');
    }
    return db.fiscalDocument.upsert({
      where: { saleId },
      create: {
        saleId,
        kind,
        status: FiscalDocumentStatus.QUEUED,
        lastError: null,
        nextAttemptAt: new Date(),
      },
      update: {
        kind,
        status: FiscalDocumentStatus.QUEUED,
        lastError: null,
        nextAttemptAt: new Date(),
        accessKey: null,
        protocol: null,
        sefazEnvironment: null,
      },
    });
  }

  async findBySaleId(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({ where: { id: saleId }, select: { id: true } });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    return db.fiscalDocument.findUnique({ where: { saleId } });
  }

  /**
   * Cancelamento local do documento fiscal (marca CANCELLED).
   * Transmissão do evento de cancelamento à SEFAZ será integrada na etapa seguinte.
   */
  async cancelById(
    tenantSlug: string,
    documentId: string,
    userId: string,
    userRoles: string[],
    permissionPassword?: string,
  ) {
    await this.userPermissions.assertPermission(
      tenantSlug,
      userId,
      userRoles,
      UserPermissionCode.FISCAL_DOC_CANCEL,
      permissionPassword,
    );

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const doc = await db.fiscalDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Documento fiscal não encontrado.');
    if (doc.status === FiscalDocumentStatus.CANCELLED) {
      throw new BadRequestException('Documento fiscal já cancelado.');
    }

    return db.fiscalDocument.update({
      where: { id: documentId },
      data: {
        status: FiscalDocumentStatus.CANCELLED,
        lastError: null,
      },
    });
  }
}
