import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogAction } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export type RecordActivityInput = {
  tenantSlug: string;
  userId: string;
  action: ActivityLogAction;
  summary: string;
  entityType?: string | null;
  entityRef?: string | null;
};

@Injectable()
export class ActivityLogService {
  private readonly log = new Logger(ActivityLogService.name);

  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Grava log de auditoria sem bloquear a requisição principal. */
  record(input: RecordActivityInput): void {
    void this.recordAsync(input).catch((err) => {
      this.log.warn(`Falha ao gravar log: ${(err as Error).message}`);
    });
  }

  private async recordAsync(input: RecordActivityInput): Promise<void> {
    const summary = input.summary.trim().slice(0, 500);
    if (!summary) return;

    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    await db.userActivityLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        summary,
        entityType: input.entityType?.trim().slice(0, 120) || null,
        entityRef: input.entityRef?.trim().slice(0, 200) || null,
      },
    });
  }
}
