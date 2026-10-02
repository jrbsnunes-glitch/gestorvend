/**
 * Transfere vendas de um caixa para outro quando ficaram na sessão errada
 * (ex.: caixa anterior não fechado a tempo — vendas do dia seguinte na janela legada).
 *
 * Regra de caixa no GestorVend:
 *   - Vendas com `cashSessionId` explícito entram só nesse caixa.
 *   - Vendas PDV sem FK entram pelo operador + `createdAt ∈ [openedAt, closedAt]`.
 *
 * Este script define `cashSessionId` da sessão destino nas vendas selecionadas,
 * removendo-as do caixa origem (listagem e detalhe).
 *
 * Uso (sempre dry-run primeiro):
 *   npm run tenant:transfer-cash-sales -w @gestorvend/api -- ^
 *     --slug LOJA --from-control 66 --to-control 67 --sale-date 2026-10-02 --dry-run
 *
 *   npm run tenant:transfer-cash-sales -w @gestorvend/api -- ^
 *     --slug LOJA --from-control 66 --to-control 67 --sale-date 2026-10-02 --confirm LOJA
 *
 * Opções:
 *   --slug <tenant>           (obrigatório)
 *   --from-control <n>        número de controle do caixa origem (ex.: 66)
 *   --to-control <n>          número de controle do caixa destino (ex.: 67)
 *   --sale-date YYYY-MM-DD    dia civil das vendas a mover (data de registro `createdAt`)
 *   --tz-offset ±HH:MM        fuso da loja para o dia (default: -03:00)
 *   --confirm <tenant>        repete o slug para gravar (sem isso, só dry-run)
 *   --dry-run                 só lista (também é o default sem --confirm)
 *   --include-cancelled       inclui vendas CANCELLED (default: só COMPLETED)
 *
 * Variáveis: CENTRAL_DATABASE_URL, TENANT_DATABASE_URL
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as CentralClient } from '../src/generated/central-client';
import {
  PrismaClient as TenantClient,
  SaleStatus,
} from '../src/generated/tenant-client';
import { buildTenantDatabaseUrl } from '../src/provisioning/tenant-database-name';

/* eslint-disable no-console */

function loadEnvFile(filePath: string, opts: { overwriteDbUrls?: boolean } = {}): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(1 + eq).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const isDbUrl = key === 'CENTRAL_DATABASE_URL' || key === 'TENANT_DATABASE_URL';
    if (isDbUrl && opts.overwriteDbUrls) {
      process.env[key] = value;
      continue;
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith('--')) {
      out[key] = val;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function parseDayRange(day: string, tzOffset: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`--sale-date inválido: "${day}". Use YYYY-MM-DD (ex.: 2026-10-02).`);
  }
  if (!/^[+-]\d{2}:\d{2}$/.test(tzOffset)) {
    throw new Error(`--tz-offset inválido: "${tzOffset}". Use ±HH:MM (ex.: -03:00).`);
  }
  const start = new Date(`${day}T00:00:00.000${tzOffset}`);
  const end = new Date(`${day}T23:59:59.999${tzOffset}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Data inválida: ${day}${tzOffset}`);
  }
  return { start, end };
}

function money(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatLocal(d: Date, tzOffset: string): string {
  const sign = tzOffset.startsWith('-') ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(':').map(Number);
  const shifted = new Date(d.getTime() + sign * ((h! * 60 + m!) * 60_000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${String(shifted.getUTCFullYear()).slice(-2)} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

type SaleRow = {
  id: string;
  number: number;
  total: unknown;
  status: SaleStatus;
  createdAt: Date;
  cashSessionId: string | null;
  userId: string | null;
};

function isAttributedToSession(
  sale: SaleRow,
  session: { id: string; userId: string; openedAt: Date; closedAt: Date | null },
  now: Date,
): boolean {
  if (sale.cashSessionId === session.id) return true;
  if (sale.cashSessionId != null) return false;
  if (sale.userId !== session.userId) return false;
  const upper = session.closedAt ?? now;
  return sale.createdAt >= session.openedAt && sale.createdAt <= upper;
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug ?? '').trim();
  const fromControl = Number(args['from-control']);
  const toControl = Number(args['to-control']);
  const saleDate = String(args['sale-date'] ?? '').trim();
  const tzOffset = String(args['tz-offset'] ?? '-03:00').trim();
  const confirm = String(args.confirm ?? '').trim();
  const dryRun = args['dry-run'] === true || confirm === '';
  const includeCancelled = args['include-cancelled'] === true;

  if (!slug) throw new Error('Informe --slug (ex.: --slug minhaloja).');
  if (!Number.isInteger(fromControl) || fromControl < 1) {
    throw new Error('Informe --from-control (número inteiro, ex.: 66).');
  }
  if (!Number.isInteger(toControl) || toControl < 1) {
    throw new Error('Informe --to-control (número inteiro, ex.: 67).');
  }
  if (fromControl === toControl) {
    throw new Error('--from-control e --to-control devem ser diferentes.');
  }
  if (!saleDate) {
    throw new Error('Informe --sale-date (ex.: --sale-date 2026-10-02).');
  }
  if (!dryRun && confirm !== slug) {
    throw new Error(`--confirm precisa repetir o slug exatamente: --confirm ${slug}`);
  }

  const { start: dayStart, end: dayEnd } = parseDayRange(saleDate, tzOffset);

  const centralUrl = process.env.CENTRAL_DATABASE_URL?.trim();
  const tenantTemplate = process.env.TENANT_DATABASE_URL?.trim();
  if (!centralUrl || !tenantTemplate) {
    throw new Error('CENTRAL_DATABASE_URL e TENANT_DATABASE_URL são obrigatórios no .env.');
  }

  const central = new CentralClient({ datasources: { db: { url: centralUrl } } });
  const tenant = await central.tenant.findUnique({ where: { slug } });
  await central.$disconnect();
  if (!tenant) throw new Error(`Tenant não encontrado: slug "${slug}".`);

  const tenantUrl = buildTenantDatabaseUrl(tenantTemplate, tenant.databaseName);
  const db = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  const [fromSession, toSession] = await Promise.all([
    db.cashRegisterSession.findUnique({
      where: { controlNumber: fromControl },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    db.cashRegisterSession.findUnique({
      where: { controlNumber: toControl },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  if (!fromSession) {
    throw new Error(`Caixa origem #${fromControl} não encontrado.`);
  }
  if (!toSession) {
    throw new Error(`Caixa destino #${toControl} não encontrado.`);
  }

  console.log('--- Contexto ---');
  console.log(`Tenant: ${slug} (${tenant.companyName ?? tenant.slug})`);
  console.log(
    `Origem #${fromSession.controlNumber}: ${fromSession.user.name} — aberto ${formatLocal(fromSession.openedAt, tzOffset)} — fechado ${fromSession.closedAt ? formatLocal(fromSession.closedAt, tzOffset) : '(aberto)'}`,
  );
  console.log(
    `Destino #${toSession.controlNumber}: ${toSession.user.name} — aberto ${formatLocal(toSession.openedAt, tzOffset)} — fechado ${toSession.closedAt ? formatLocal(toSession.closedAt, tzOffset) : '(aberto)'}`,
  );
  console.log(`Dia das vendas (${tzOffset}): ${saleDate}`);
  console.log('');

  if (fromSession.userId !== toSession.userId) {
    console.warn(
      'AVISO: operadores diferentes entre origem e destino. O script só move vendas do userId do caixa origem.',
    );
  }

  const statusFilter: SaleStatus[] = includeCancelled
    ? [SaleStatus.COMPLETED, SaleStatus.CANCELLED]
    : [SaleStatus.COMPLETED];

  const candidates = await db.sale.findMany({
    where: {
      userId: fromSession.userId,
      createdAt: { gte: dayStart, lte: dayEnd },
      status: { in: statusFilter },
    },
    select: {
      id: true,
      number: true,
      total: true,
      status: true,
      createdAt: true,
      cashSessionId: true,
      userId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const now = new Date();
  const toMove = candidates.filter(
    (s) =>
      isAttributedToSession(s, fromSession, now) &&
      s.cashSessionId !== toSession.id,
  );

  const alreadyOnDest = candidates.filter((s) => s.cashSessionId === toSession.id);
  const onDayNotOnFrom = candidates.filter(
    (s) => !isAttributedToSession(s, fromSession, now) && s.cashSessionId !== toSession.id,
  );

  let sumCompleted = 0;
  for (const s of toMove) {
    if (s.status === SaleStatus.COMPLETED) sumCompleted += Number(s.total);
  }

  console.log(`Vendas no dia (operador origem, status filtrado): ${candidates.length}`);
  console.log(`Já no caixa destino (#${toControl}): ${alreadyOnDest.length}`);
  console.log(`No dia mas não atribuídas ao caixa #${fromControl}: ${onDayNotOnFrom.length}`);
  console.log(`A transferir para #${toControl}: ${toMove.length} (COMPLETED ≈ ${money(sumCompleted)})`);
  console.log('');

  if (toMove.length === 0) {
    console.log('Nada a fazer.');
    await db.$disconnect();
    return;
  }

  console.log('--- Vendas a transferir ---');
  for (const s of toMove) {
    const fk =
      s.cashSessionId == null
        ? 'legado (sem FK)'
        : s.cashSessionId === fromSession.id
          ? 'FK origem'
          : `FK ${s.cashSessionId.slice(0, 8)}…`;
    console.log(
      `  #${s.number}  ${formatLocal(s.createdAt, tzOffset)}  ${money(Number(s.total))}  ${s.status}  ${fk}`,
    );
  }
  console.log('');

  if (dryRun) {
    console.log('Dry-run: nenhuma alteração gravada. Use --confirm ' + slug + ' para aplicar.');
    await db.$disconnect();
    return;
  }

  const ids = toMove.map((s) => s.id);
  const updated = await db.$transaction(async (tx) => {
    return tx.sale.updateMany({
      where: { id: { in: ids } },
      data: { cashSessionId: toSession.id },
    });
  });

  console.log(`Gravado: ${updated.count} venda(s) com cashSessionId → sessão #${toControl}.`);
  console.log(
    'Recomendado: reabrir conferência do caixa #66 (estava pendente) e conferir totais de #66 e #67.',
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
