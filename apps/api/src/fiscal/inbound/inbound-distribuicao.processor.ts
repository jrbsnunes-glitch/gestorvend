import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { TenantProvisioningStatus } from '../../generated/central-client';
import { CentralPrismaService } from '../../prisma/central-prisma.service';
import { InboundNfeService } from './inbound-nfe.service';

/**
 * Polling periódico da Distribuição DF-e (NSU) para descobrir NF-e emitidas
 * contra o CNPJ do tenant. Com auto-lançamento desligado, apenas enfileira
 * documentos para revisão (Caixa de entrada).
 */
@Injectable()
export class InboundDistribuicaoProcessorService {
  private readonly log = new Logger(InboundDistribuicaoProcessorService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly central: CentralPrismaService,
    private readonly inbound: InboundNfeService,
  ) {}

  /** A cada 5 minutos — Distribuição DF-e tem limites de frequência na SEFAZ. */
  @Interval(5 * 60_000)
  async pollAllTenants(): Promise<void> {
    if (this.config.get<string>('FISCAL_MODULE_ENABLED') !== 'true') {
      return;
    }
    if ((this.config.get<string>('FISCAL_INBOUND_TRANSPORT') ?? 'soap').toLowerCase() === 'dry-run') {
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.central.tenant.findMany({
        where: { provisioningStatus: TenantProvisioningStatus.READY },
        select: { slug: true },
      });
      for (const t of tenants) {
        try {
          const result = await this.inbound.pollDistNsu(t.slug);
          if (result.ingested > 0) {
            this.log.log(
              `Inbound NSU ${t.slug}: ${result.ingested} doc(s) · ultNSU=${result.ultNSU ?? '-'}`,
            );
          }
        } catch (e) {
          this.log.warn(`Inbound NSU worker tenant ${t.slug}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
