/**
 * Reorganiza vendas entre dois caixas por número da venda (#controle).
 *
 * Caso típico: caixa aberto hoje acumulou vendas do dia anterior; você define
 * quais números de venda ficam no caixa de hoje e manda o restante para o caixa fechado anterior.
 *
 * Ações:
 *   1) Vendas listadas em --keep-sale-numbers → cashSessionId do caixa --primary-control (hoje).
 *   2) Demais vendas atribuídas ao caixa primário → cashSessionId do --secondary-control.
 *
 * Uso (dry-run primeiro):
 *   npm run tenant:reassign-cash-sales -w @gestorvend/api -- \
 *     --slug str --primary-control 71 --secondary-control 70 \
 *     --keep-sale-numbers 4179,4180,4181,4182,4183,4184 --dry-run
 *
 *   ... --confirm str
 *
 * Opções:
 *   --slug, --primary-control, --secondary-control (obrigatórios)
 *   --keep-sale-numbers  lista separada por vírgula (números da venda, ex.: 4179,4180)
 *   --confirm <slug>     grava; sem isso só dry-run
 *   --dry-run
 *   --tz-offset ±HH:MM   só para exibir datas no log (default -03:00)
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
    let value = trimmed.slice(eq + 1).trim();
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

function parseKeepNumbers(raw: string): Set<number> {
  const set = new Set<number>();
  for (const part of raw.split(/[,;\s]+/)) {
    const t = part.trim().replace(/^#/, '');
    if (!t) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Número de venda inválido em --keep-sale-numbers: "${part}"`);
    }
    set.add(n);
  }
  if (set.size === 0) {
    throw new Error('Informe ao menos um número em --keep-sale-numbers.');
  }
  return set;
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

async function loadSalesAttributedToSession(
  db: TenantClient,
  session: { id: string; userId: string; openedAt: Date; closedAt: Date | null },
  now: Date,
): Promise<SaleRow[]> {
  const upper = session.closedAt ?? now;
  const rows = await db.sale.findMany({
    where: {
      OR: [
        { cashSessionId: session.id },
        {
          cashSessionId: null,
          userId: session.userId,
          createdAt: { gte: session.openedAt, lte: upper },
        },
      ],
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
    orderBy: { number: 'asc' },
  });
  return rows.filter((s) => isAttributedToSession(s, session, now));
}

function logSale(s: SaleRow, tzOffset: string, note: string) {
  console.log(
    `  #${s.number}  ${formatLocal(s.createdAt, tzOffset)}  ${money(Number(s.total))}  ${s.status}  ${note}`,
  );
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug ?? '').trim();
  const primaryControl = Number(args['primary-control']);
  const secondaryControl = Number(args['secondary-control']);
  const keepRaw = String(args['keep-sale-numbers'] ?? '').trim();
  const tzOffset = String(args['tz-offset'] ?? '-03:00').trim();
  const confirm = String(args.confirm ?? '').trim();
  const dryRun = args['dry-run'] === true || confirm === '';

  if (!slug) throw new Error('Informe --slug.');
  if (!Number.isInteger(primaryControl) || primaryControl < 1) {
    throw new Error('Informe --primary-control (caixa de hoje / destino das vendas mantidas).');
  }
  if (!Number.isInteger(secondaryControl) || secondaryControl < 1) {
    throw new Error('Informe --secondary-control (caixa anterior).');
  }
  if (primaryControl === secondaryControl) {
    throw new Error('--primary-control e --secondary-control devem ser diferentes.');
  }
  const keepNumbers = parseKeepNumbers(keepRaw);
  if (!dryRun && confirm !== slug) {
    throw new Error(`--confirm precisa repetir o slug: --confirm ${slug}`);
  }

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

  const [primary, secondary] = await Promise.all([
    db.cashRegisterSession.findUnique({
      where: { controlNumber: primaryControl },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
    db.cashRegisterSession.findUnique({
      where: { controlNumber: secondaryControl },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  if (!primary) throw new Error(`Caixa primário #${primaryControl} não encontrado.`);
  if (!secondary) throw new Error(`Caixa secundário #${secondaryControl} não encontrado.`);

  console.log('--- Contexto ---');
  console.log(`Tenant: ${slug} (${tenant.companyName ?? tenant.slug})`);
  console.log(
    `Primário #${primary.controlNumber} (${primary.status}): ${primary.user.name} — aberto ${formatLocal(primary.openedAt, tzOffset)}`,
  );
  console.log(
    `Secundário #${secondary.controlNumber} (${secondary.status}): ${secondary.user.name} — aberto ${formatLocal(secondary.openedAt, tzOffset)} — fechado ${secondary.closedAt ? formatLocal(secondary.closedAt, tzOffset) : '—'}`,
  );
  console.log(`Manter no primário (nº venda): ${[...keepNumbers].sort((a, b) => a - b).join(', ')}`);
  console.log('');

  const now = new Date();
  const onPrimary = await loadSalesAttributedToSession(db, primary, now);

  const moveToSecondary = onPrimary.filter((s) => !keepNumbers.has(s.number));
  const keepSales = await db.sale.findMany({
    where: { number: { in: [...keepNumbers] } },
    select: {
      id: true,
      number: true,
      total: true,
      status: true,
      createdAt: true,
      cashSessionId: true,
      userId: true,
    },
    orderBy: { number: 'asc' },
  });

  const missingKeep = [...keepNumbers].filter((n) => !keepSales.some((s) => s.number === n));
  if (missingKeep.length) {
    console.warn(`AVISO: vendas não encontradas no banco: ${missingKeep.join(', ')}`);
  }

  const pinToPrimary = keepSales.filter((s) => s.cashSessionId !== primary.id);

  let sumOut = 0;
  let sumPin = 0;
  for (const s of moveToSecondary) {
    if (s.status === SaleStatus.COMPLETED) sumOut += Number(s.total);
  }
  for (const s of pinToPrimary) {
    if (s.status === SaleStatus.COMPLETED) sumPin += Number(s.total);
  }

  console.log(`Vendas atribuídas ao caixa #${primaryControl}: ${onPrimary.length}`);
  console.log(`→ Enviar para #${secondaryControl}: ${moveToSecondary.length} (COMPLETED ≈ ${money(sumOut)})`);
  console.log(`→ Fixar no #${primaryControl}: ${pinToPrimary.length} venda(s) (${keepNumbers.size} números informados)`);
  console.log('');

  if (moveToSecondary.length) {
    console.log(`--- Para caixa #${secondaryControl} ---`);
    for (const s of moveToSecondary) {
      logSale(s, tzOffset, s.cashSessionId === primary.id ? 'FK primário' : 'legado primário');
    }
    console.log('');
  }

  if (pinToPrimary.length) {
    console.log(`--- Fixar no caixa #${primaryControl} ---`);
    for (const s of pinToPrimary) {
      const from =
        s.cashSessionId === secondary.id
          ? 'FK secundário'
          : s.cashSessionId
            ? `FK outro`
            : 'sem FK / legado';
      logSale(s, tzOffset, from);
    }
    console.log('');
  }

  const updates: Array<{ id: string; cashSessionId: string; label: string }> = [];
  for (const s of moveToSecondary) {
    updates.push({ id: s.id, cashSessionId: secondary.id, label: `#${s.number} → #${secondaryControl}` });
  }
  for (const s of pinToPrimary) {
    updates.push({ id: s.id, cashSessionId: primary.id, label: `#${s.number} → #${primaryControl}` });
  }

  if (updates.length === 0) {
    console.log('Nada a alterar — vendas já estão nos caixas esperados.');
    await db.$disconnect();
    return;
  }

  if (dryRun) {
    console.log(`Dry-run: ${updates.length} alteração(ões). Use --confirm ${slug} para aplicar.`);
    await db.$disconnect();
    return;
  }

  await db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.sale.update({
        where: { id: u.id },
        data: { cashSessionId: u.cashSessionId },
      });
    }
  });

  console.log(`Gravado: ${updates.length} venda(s) atualizada(s).`);
  console.log('Confira o detalhe do caixa #' + primaryControl + ' e reconferência do #' + secondaryControl + ' se necessário.');

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
