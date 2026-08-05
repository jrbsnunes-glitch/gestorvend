import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { TenantProvisioningStatus } from '../generated/central-client';
import { PrintJobKind, PrintJobStatus } from '../generated/tenant-client';
import { CentralPrismaService } from '../prisma/central-prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import type { KitchenPrintPayload, PrintJobPayload } from './print-payload';

const STALE_CLAIM_MS = 2 * 60_000;
const BCRYPT_ROUNDS = 10;

export type EnqueueKitchenResult = {
  jobIds: string[];
  dispatched: boolean;
  stationName: string | null;
  stationNames: string[];
};

@Injectable()
export class PrintingService {
  private readonly log = new Logger(PrintingService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly central: CentralPrismaService,
    private readonly config: ConfigService,
  ) {}

  private async db(tenantSlug: string) {
    return this.tenantPrisma.getClient(tenantSlug);
  }

  parseSectors(csv: string): string[] {
    return csv
      .split(/[,;|]/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  sectorsToCsv(sectors: string[]): string {
    const uniq = [...new Set(sectors.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    return uniq.length ? uniq.join(',') : 'COZINHA';
  }

  /** Cria estação e devolve o token de pareamento uma única vez (`id.secret`). */
  async createStation(
    tenantSlug: string,
    body: { name: string; sectors?: string[] | string },
  ) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('Informe o nome da estação.');
    const sectorsCsv =
      typeof body.sectors === 'string'
        ? this.sectorsToCsv(this.parseSectors(body.sectors))
        : this.sectorsToCsv(body.sectors ?? ['COZINHA']);
    const id = randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    const db = await this.db(tenantSlug);
    const row = await db.printStation.create({
      data: { id, name, secretHash, sectors: sectorsCsv, enabled: true },
    });
    return {
      id: row.id,
      name: row.name,
      sectors: this.parseSectors(row.sectors),
      enabled: row.enabled,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      /** Mostrar só na criação — não é recuperável depois. */
      token: `${row.id}.${secret}`,
    };
  }

  async listStations(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    const rows = await db.printStation.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sectors: this.parseSectors(r.sectors),
      enabled: r.enabled,
      lastSeenAt: r.lastSeenAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async updateStation(
    tenantSlug: string,
    id: string,
    body: { name?: string; sectors?: string[] | string; enabled?: boolean },
  ) {
    const db = await this.db(tenantSlug);
    const existing = await db.printStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Estação não encontrada.');
    const data: { name?: string; sectors?: string; enabled?: boolean } = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Nome inválido.');
      data.name = name;
    }
    if (body.sectors !== undefined) {
      data.sectors =
        typeof body.sectors === 'string'
          ? this.sectorsToCsv(this.parseSectors(body.sectors))
          : this.sectorsToCsv(body.sectors);
    }
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
    const row = await db.printStation.update({ where: { id }, data });
    return {
      id: row.id,
      name: row.name,
      sectors: this.parseSectors(row.sectors),
      enabled: row.enabled,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Gera novo segredo (invalida o token anterior). */
  async rotateStationToken(tenantSlug: string, id: string) {
    const db = await this.db(tenantSlug);
    const existing = await db.printStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Estação não encontrada.');
    const secret = randomBytes(24).toString('base64url');
    const secretHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);
    await db.printStation.update({ where: { id }, data: { secretHash } });
    return { id, token: `${id}.${secret}` };
  }

  async deleteStation(tenantSlug: string, id: string) {
    const db = await this.db(tenantSlug);
    const existing = await db.printStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Estação não encontrada.');
    await db.printJob.updateMany({
      where: { stationId: id, status: { in: [PrintJobStatus.PENDING, PrintJobStatus.CLAIMED] } },
      data: { stationId: null },
    });
    await db.printStation.delete({ where: { id } });
    return { ok: true };
  }

  async listJobs(
    tenantSlug: string,
    opts?: { status?: PrintJobStatus; take?: number },
  ) {
    const db = await this.db(tenantSlug);
    const take = Math.min(Math.max(opts?.take ?? 50, 1), 200);
    return db.printJob.findMany({
      where: opts?.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      include: { station: { select: { id: true, name: true } } },
    });
  }

  async enqueue(
    tenantSlug: string,
    input: {
      kind: PrintJobKind;
      sector: string;
      payload: PrintJobPayload;
      tabId?: string | null;
      copies?: number;
    },
  ) {
    const sector = (input.sector || 'COZINHA').trim().toUpperCase() || 'COZINHA';
    const db = await this.db(tenantSlug);
    return db.printJob.create({
      data: {
        kind: input.kind,
        sector,
        payload: input.payload as object,
        tabId: input.tabId ?? null,
        copies: Math.max(1, Math.min(input.copies ?? 1, 5)),
        status: PrintJobStatus.PENDING,
      },
    });
  }

  /**
   * Enfileira um PrintJob por setor a partir dos itens da cozinha.
   * `dispatched` = há pelo menos uma estação habilitada cobrindo os setores.
   */
  async enqueueKitchenJobs(
    tenantSlug: string,
    tab: {
      id: string;
      number: number;
      guestCount: number;
      table?: {
        code: string;
        label: string | null;
        area?: { name: string } | null;
      } | null;
      openedBy?: { name: string } | null;
    },
    items: Array<{
      id: string;
      quantity: unknown;
      notes: string | null;
      printSector: string | null;
      kitchenPrintedAt: Date | null;
      variant: { product: { name: string; taxUnit: string | null } };
    }>,
    opts?: { additional?: boolean },
  ): Promise<EnqueueKitchenResult> {
    if (!items.length) {
      return { jobIds: [], dispatched: false, stationName: null, stationNames: [] };
    }

    const bySector = new Map<string, typeof items>();
    for (const it of items) {
      const sector = (it.printSector?.trim().toUpperCase() || 'COZINHA');
      const list = bySector.get(sector) ?? [];
      list.push(it);
      bySector.set(sector, list);
    }

    const db = await this.db(tenantSlug);
    const stations = await db.printStation.findMany({ where: { enabled: true } });
    const covering = new Map<string, string[]>(); // sector -> station names
    for (const st of stations) {
      const secs = this.parseSectors(st.sectors);
      for (const s of secs) {
        const names = covering.get(s) ?? [];
        names.push(st.name);
        covering.set(s, names);
      }
    }

    const additional =
      opts?.additional ??
      (await db.serviceTabItem.count({
        where: {
          tabId: tab.id,
          kitchenPrintedAt: { not: null },
          id: { notIn: items.map((i) => i.id) },
          status: { not: 'CANCELLED' },
        },
      })) > 0;

    const printedAt = new Date().toISOString();
    const jobIds: string[] = [];
    const stationNames = new Set<string>();

    for (const [sector, sectorItems] of bySector) {
      const names = covering.get(sector) ?? [];
      if (!names.length) continue; // sem estação para o setor → fallback no browser

      names.forEach((n) => stationNames.add(n));
      const payload: KitchenPrintPayload = {
        kind: 'KITCHEN',
        title: sector,
        tabNumber: tab.number,
        tableCode: tab.table?.code ?? null,
        tableLabel: tab.table?.label ?? null,
        areaName: tab.table?.area?.name ?? null,
        guestCount: tab.guestCount ?? 1,
        waiterName: tab.openedBy?.name ?? null,
        additional: Boolean(additional),
        printedAt,
        items: sectorItems.map((it) => ({
          id: it.id,
          name: it.variant.product.name,
          quantity: Number(it.quantity),
          unit: it.variant.product.taxUnit,
          notes: it.notes,
        })),
      };
      const job = await this.enqueue(tenantSlug, {
        kind: PrintJobKind.KITCHEN,
        sector,
        payload,
        tabId: tab.id,
      });
      jobIds.push(job.id);
    }

    const namesArr = [...stationNames];
    return {
      jobIds,
      dispatched: jobIds.length > 0,
      stationName: namesArr[0] ?? null,
      stationNames: namesArr,
    };
  }

  async retryJob(tenantSlug: string, jobId: string) {
    const db = await this.db(tenantSlug);
    const job = await db.printJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job não encontrado.');
    if (job.status === PrintJobStatus.DONE) {
      // reimpressão: clona como novo PENDING
      const clone = await db.printJob.create({
        data: {
          kind: job.kind,
          sector: job.sector,
          payload: job.payload as object,
          copies: job.copies,
          tabId: job.tabId,
          status: PrintJobStatus.PENDING,
        },
      });
      return clone;
    }
    return db.printJob.update({
      where: { id: jobId },
      data: {
        status: PrintJobStatus.PENDING,
        claimedAt: null,
        printedAt: null,
        error: null,
        stationId: null,
      },
    });
  }

  async enqueueTestJob(tenantSlug: string, stationId: string) {
    const db = await this.db(tenantSlug);
    const st = await db.printStation.findUnique({ where: { id: stationId } });
    if (!st) throw new NotFoundException('Estação não encontrada.');
    const sectors = this.parseSectors(st.sectors);
    const sector = sectors[0] ?? 'COZINHA';
    const payload: KitchenPrintPayload = {
      kind: 'KITCHEN',
      title: sector,
      tabNumber: 0,
      guestCount: 1,
      waiterName: null,
      additional: false,
      printedAt: new Date().toISOString(),
      items: [
        {
          id: 'test',
          name: `TESTE — ${st.name}`,
          quantity: 1,
          unit: null,
          notes: 'Impressão de teste da estação',
        },
      ],
    };
    return this.enqueue(tenantSlug, {
      kind: PrintJobKind.KITCHEN,
      sector,
      payload,
    });
  }

  async authenticateStation(
    tenantSlug: string,
    token: string,
  ): Promise<{ id: string; name: string; sectors: string[] }> {
    const slug = (tenantSlug ?? '').trim().toLowerCase();
    if (!slug) throw new BadRequestException('Parâmetro tenant inválido.');
    const raw = (token ?? '').trim();
    const dot = raw.indexOf('.');
    if (dot <= 0) throw new UnauthorizedException('Token de estação inválido.');
    const stationId = raw.slice(0, dot);
    const secret = raw.slice(dot + 1);
    if (!stationId || !secret) throw new UnauthorizedException('Token de estação inválido.');

    const db = await this.db(slug);
    const st = await db.printStation.findUnique({ where: { id: stationId } });
    if (!st || !st.enabled) throw new UnauthorizedException('Estação inválida ou desativada.');
    const ok = await bcrypt.compare(secret, st.secretHash);
    if (!ok) throw new UnauthorizedException('Token de estação inválido.');
    await db.printStation.update({
      where: { id: stationId },
      data: { lastSeenAt: new Date() },
    });
    return { id: st.id, name: st.name, sectors: this.parseSectors(st.sectors) };
  }

  async claimJobs(tenantSlug: string, stationId: string, sectors: string[], limit = 5) {
    const db = await this.db(tenantSlug);
    const take = Math.min(Math.max(limit, 1), 20);
    const sectorFilter = sectors.length ? sectors : ['COZINHA'];

    return db.$transaction(async (tx) => {
      const pending = await tx.printJob.findMany({
        where: {
          status: PrintJobStatus.PENDING,
          sector: { in: sectorFilter },
        },
        orderBy: { createdAt: 'asc' },
        take,
      });
      const claimed: typeof pending = [];
      const now = new Date();
      for (const job of pending) {
        const res = await tx.printJob.updateMany({
          where: { id: job.id, status: PrintJobStatus.PENDING },
          data: {
            status: PrintJobStatus.CLAIMED,
            stationId,
            claimedAt: now,
            attempts: { increment: 1 },
          },
        });
        if (res.count === 1) {
          claimed.push({
            ...job,
            status: PrintJobStatus.CLAIMED,
            stationId,
            claimedAt: now,
            attempts: job.attempts + 1,
          });
        }
      }
      return claimed.map((j) => ({
        id: j.id,
        kind: j.kind,
        sector: j.sector,
        payload: j.payload,
        copies: j.copies,
        attempts: j.attempts,
        tabId: j.tabId,
        createdAt: j.createdAt,
      }));
    });
  }

  async ackJob(
    tenantSlug: string,
    stationId: string,
    jobId: string,
    body: { ok: boolean; error?: string },
  ) {
    const db = await this.db(tenantSlug);
    const job = await db.printJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job não encontrado.');
    if (job.stationId && job.stationId !== stationId) {
      throw new BadRequestException('Job reivindicado por outra estação.');
    }
    if (body.ok) {
      return db.printJob.update({
        where: { id: jobId },
        data: {
          status: PrintJobStatus.DONE,
          printedAt: new Date(),
          error: null,
          stationId,
        },
      });
    }
    const msg = (body.error ?? 'Erro na impressão').slice(0, 1000);
    return db.printJob.update({
      where: { id: jobId },
      data: {
        status: PrintJobStatus.ERROR,
        error: msg,
        stationId,
      },
    });
  }

  async requeueStale(tenantSlug: string) {
    const db = await this.db(tenantSlug);
    const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
    const res = await db.printJob.updateMany({
      where: {
        status: PrintJobStatus.CLAIMED,
        claimedAt: { lt: cutoff },
      },
      data: {
        status: PrintJobStatus.PENDING,
        claimedAt: null,
        stationId: null,
      },
    });
    return res.count;
  }

  @Interval(60_000)
  async requeueStaleAllTenants(): Promise<void> {
    if (this.config.get<string>('PRINT_QUEUE_DISABLED') === 'true') return;
    const tenants = await this.central.tenant.findMany({
      where: { provisioningStatus: TenantProvisioningStatus.READY },
      select: { slug: true },
    });
    for (const t of tenants) {
      try {
        const n = await this.requeueStale(t.slug);
        if (n > 0) this.log.log(`Print queue: requeued ${n} stale job(s) for ${t.slug}`);
      } catch (e) {
        this.log.warn(`Print queue tenant ${t.slug}: ${(e as Error).message}`);
      }
    }
  }
}
