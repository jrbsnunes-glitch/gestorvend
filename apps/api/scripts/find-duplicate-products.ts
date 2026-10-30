/**
 * Encontra produtos duplicados em UM tenant e lista candidatos à exclusão.
 *
 * Duplicata = mesmo nome normalizado (padrão) ou mesmo código de barras (`--by barcode`).
 * Em cada grupo, o produto com mais uso operacional é o KEEP. Os demais são
 * ordenados da menor para a maior movimentação, para análise antes de apagar.
 *
 * Exclusão física só acontece com `--confirm <slug>` e somente para duplicatas
 * SEM uso (vendas, movimentação, entradas, saídas, reservas, etc.) e saldo zero.
 * Duplicatas com alguma movimentação entram só no relatório (`revisar`).
 *
 * Uso (sempre o dry-run primeiro):
 *   npm run tenant:duplicate-products -w @gestorvend/api -- --slug balby
 *   npm run tenant:duplicate-products -w @gestorvend/api -- --slug balby --by barcode
 *   npm run tenant:duplicate-products -w @gestorvend/api -- --slug balby --csv
 *   npm run tenant:duplicate-products -w @gestorvend/api -- --slug balby --confirm balby
 *
 * Opções:
 *   --slug <tenant>     (obrigatório) um único tenant do banco central.
 *   --by name|barcode   chave de agrupamento (default: name).
 *   --only-zero         lista só grupos que têm ao menos um extra sem uso.
 *   --csv [path]        CSV da listagem (default: apps/api/data/duplicados-<slug>-<by>.csv).
 *   --confirm <tenant>  repete o slug para apagar só os `candidato_exclusao`.
 *   --dry-run           só lista (default se não houver --confirm).
 *
 * Variáveis: CENTRAL_DATABASE_URL, TENANT_DATABASE_URL (modelo; troca só o nome do DB).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as CentralClient } from '../src/generated/central-client';
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';
import { buildTenantDatabaseUrl } from '../src/provisioning/tenant-database-name';

/* eslint-disable no-console */

type CountMap = Map<string, number>;
type ByKey = 'name' | 'barcode';
type Role = 'KEEP' | 'EXTRA';
type Decision = 'manter' | 'candidato_exclusao' | 'revisar';

type ProductRow = {
  id: string;
  name: string;
  controlNumber: number;
  isActive: boolean;
  defaultBarcode: string | null;
  variants: Array<{ id: string; sku: string; barcode: string | null }>;
};

type Usage = {
  movimentos: number;
  vendas: number;
  entradas: number;
  saidas: number;
  inventario: number;
  reservas: number;
  comandas: number;
  os: number;
  receitas: number;
  fabrica: number;
  packDeOutros: number;
  saldo: number;
  score: number;
};

type Listed = {
  groupKey: string;
  role: Role;
  decision: Decision;
  product: ProductRow;
  usage: Usage;
  sku: string;
  barcode: string;
};

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

function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeBarcode(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .trim();
}

function sumMap(map: CountMap, ids: string[]): number {
  let n = 0;
  for (const id of ids) n += map.get(id) ?? 0;
  return n;
}

function toCountMap(
  rows: Array<{ [k: string]: string | null } & { _count: { _all: number } }>,
  field: string,
): CountMap {
  const map: CountMap = new Map();
  for (const row of rows) {
    const key = row[field];
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + row._count._all);
  }
  return map;
}

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s;
  return t.padEnd(n);
}

function isSafeToDelete(u: Usage): boolean {
  return u.score === 0 && Math.abs(u.saldo) < 1e-6;
}

async function countBy(db: TenantClient, model: string, field: string): Promise<CountMap> {
  const delegate = (db as unknown as Record<string, { groupBy: (args: unknown) => Promise<unknown> }>)[
    model
  ];
  const rows = (await delegate.groupBy({
    by: [field],
    _count: { _all: true },
  })) as Array<{ [k: string]: string | null } & { _count: { _all: number } }>;
  return toCountMap(rows, field);
}

async function loadUsage(db: TenantClient, products: ProductRow[]): Promise<Map<string, Usage>> {
  const [
    movimentos,
    vendas,
    entradas,
    saidas,
    inventario,
    reservas,
    comandas,
    os,
    receitas,
    fabricaBom,
    fabricaRes,
    fabricaIssue,
    fabricaPa,
    balances,
  ] = await Promise.all([
    countBy(db, 'stockMovement', 'variantId'),
    countBy(db, 'saleItem', 'variantId'),
    countBy(db, 'goodsReceiptItem', 'variantId'),
    countBy(db, 'stockExitItem', 'variantId'),
    countBy(db, 'stockInventoryItem', 'variantId'),
    countBy(db, 'saleReservationItem', 'variantId'),
    countBy(db, 'serviceTabItem', 'variantId'),
    countBy(db, 'serviceOrderItem', 'variantId'),
    countBy(db, 'productRecipeItem', 'ingredientVariantId'),
    countBy(db, 'manufacturingBomLine', 'ingredientVariantId'),
    countBy(db, 'manufacturingMaterialReservation', 'ingredientVariantId'),
    countBy(db, 'manufacturingMaterialIssue', 'ingredientVariantId'),
    countBy(db, 'manufacturingProject', 'finishedVariantId'),
    db.stockBalance.groupBy({ by: ['variantId'], _sum: { quantity: true } }),
  ]);

  const saldoByVariant: CountMap = new Map();
  for (const row of balances) {
    saldoByVariant.set(row.variantId, Number(row._sum.quantity ?? 0));
  }

  const packs = await db.product.findMany({
    where: { stockComponentVariantId: { not: null } },
    select: { id: true, stockComponentVariantId: true },
  });
  const usage = new Map<string, Usage>();
  for (const p of products) {
    const ids = p.variants.map((v) => v.id);
    const u: Usage = {
      movimentos: sumMap(movimentos, ids),
      vendas: sumMap(vendas, ids),
      entradas: sumMap(entradas, ids),
      saidas: sumMap(saidas, ids),
      inventario: sumMap(inventario, ids),
      reservas: sumMap(reservas, ids),
      comandas: sumMap(comandas, ids),
      os: sumMap(os, ids),
      receitas: sumMap(receitas, ids),
      fabrica:
        sumMap(fabricaBom, ids) +
        sumMap(fabricaRes, ids) +
        sumMap(fabricaIssue, ids) +
        sumMap(fabricaPa, ids),
      packDeOutros: packs.filter(
        (x) => ids.includes(x.stockComponentVariantId ?? '') && x.id !== p.id,
      ).length,
      saldo: ids.reduce((s, id) => s + (saldoByVariant.get(id) ?? 0), 0),
      score: 0,
    };
    u.score =
      u.movimentos +
      u.vendas +
      u.entradas +
      u.saidas +
      u.inventario +
      u.reservas +
      u.comandas +
      u.os +
      u.receitas +
      u.fabrica +
      u.packDeOutros;
    usage.set(p.id, u);
  }
  return usage;
}

function groupProducts(products: ProductRow[], by: ByKey): Map<string, ProductRow[]> {
  const groups = new Map<string, ProductRow[]>();
  const push = (key: string, p: ProductRow) => {
    const list = groups.get(key) ?? [];
    if (!list.some((x) => x.id === p.id)) list.push(p);
    groups.set(key, list);
  };

  for (const p of products) {
    if (by === 'name') {
      const key = normalizeName(p.name);
      if (key.length < 2) continue;
      push(key, p);
      continue;
    }
    const codes = new Set<string>();
    const main = normalizeBarcode(p.defaultBarcode);
    if (main) codes.add(main);
    for (const v of p.variants) {
      const b = normalizeBarcode(v.barcode);
      if (b) codes.add(b);
    }
    for (const code of codes) push(`ean:${code}`, p);
  }

  for (const [key, list] of groups) {
    if (list.length < 2) groups.delete(key);
  }
  return groups;
}

function pickKeeper(rows: Array<{ product: ProductRow; usage: Usage }>): ProductRow {
  const ranked = [...rows].sort((a, b) => {
    if (b.usage.score !== a.usage.score) return b.usage.score - a.usage.score;
    if (a.product.isActive !== b.product.isActive) return a.product.isActive ? -1 : 1;
    if (Math.abs(b.usage.saldo) !== Math.abs(a.usage.saldo)) {
      return Math.abs(b.usage.saldo) - Math.abs(a.usage.saldo);
    }
    return a.product.controlNumber - b.product.controlNumber;
  });
  return ranked[0]!.product;
}

function skuOf(p: ProductRow): string {
  return p.variants.map((v) => v.sku).filter(Boolean).join('|');
}

function barcodeOf(p: ProductRow): string {
  const codes = [p.defaultBarcode, ...p.variants.map((v) => v.barcode)]
    .map((c) => normalizeBarcode(c))
    .filter(Boolean);
  return [...new Set(codes)].join('|');
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug ?? '').trim();
  const byRaw = String(args.by ?? 'name').trim().toLowerCase();
  const by: ByKey = byRaw === 'barcode' ? 'barcode' : 'name';
  if (byRaw !== 'name' && byRaw !== 'barcode') {
    throw new Error(`--by inválido: "${byRaw}". Use name ou barcode.`);
  }
  const confirm = String(args.confirm ?? '').trim();
  const dryRun = args['dry-run'] === true || confirm === '';
  const onlyZero = args['only-zero'] === true;

  if (!slug) throw new Error('Informe --slug (ex.: --slug balby). O script roda em um único tenant.');
  if (!dryRun && confirm !== slug) {
    throw new Error(`--confirm precisa repetir o slug exatamente: --confirm ${slug}`);
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

  const products = (await db.product.findMany({
    select: {
      id: true,
      name: true,
      controlNumber: true,
      isActive: true,
      defaultBarcode: true,
      variants: { select: { id: true, sku: true, barcode: true } },
    },
    orderBy: { controlNumber: 'asc' },
  })) as ProductRow[];

  const usage = await loadUsage(db, products);
  const groups = groupProducts(products, by);

  const listed: Listed[] = [];
  const groupKeys = [...groups.keys()].sort();
  for (const key of groupKeys) {
    const members = groups.get(key)!;
    const withUsage = members.map((product) => ({
      product,
      usage: usage.get(product.id) ?? {
        movimentos: 0,
        vendas: 0,
        entradas: 0,
        saidas: 0,
        inventario: 0,
        reservas: 0,
        comandas: 0,
        os: 0,
        receitas: 0,
        fabrica: 0,
        packDeOutros: 0,
        saldo: 0,
        score: 0,
      },
    }));
    const keeper = pickKeeper(withUsage);
    const extras = withUsage
      .filter((m) => m.product.id !== keeper.id)
      .sort((a, b) => {
        if (a.usage.score !== b.usage.score) return a.usage.score - b.usage.score;
        return a.product.controlNumber - b.product.controlNumber;
      });

    if (onlyZero && extras.every((e) => !isSafeToDelete(e.usage))) continue;

    const keepUsage = withUsage.find((m) => m.product.id === keeper.id)!.usage;
    listed.push({
      groupKey: key,
      role: 'KEEP',
      decision: 'manter',
      product: keeper,
      usage: keepUsage,
      sku: skuOf(keeper),
      barcode: barcodeOf(keeper),
    });
    for (const extra of extras) {
      listed.push({
        groupKey: key,
        role: 'EXTRA',
        decision: isSafeToDelete(extra.usage) ? 'candidato_exclusao' : 'revisar',
        product: extra.product,
        usage: extra.usage,
        sku: skuOf(extra.product),
        barcode: barcodeOf(extra.product),
      });
    }
  }

  const groupCount = new Set(listed.map((r) => r.groupKey)).size;
  const extras = listed.filter((r) => r.role === 'EXTRA');
  const candidates = extras.filter((r) => r.decision === 'candidato_exclusao');
  const review = extras.filter((r) => r.decision === 'revisar');

  console.log(`Tenant .............. ${slug} (${tenant.companyName})`);
  console.log(`Banco ............... ${tenant.databaseName}`);
  console.log(`Agrupar por ......... ${by === 'name' ? 'nome normalizado' : 'código de barras'}`);
  console.log(`Produtos no cadastro  ${products.length}`);
  console.log(`Grupos duplicados ... ${groupCount}`);
  console.log(`Extras (duplicatas) . ${extras.length}`);
  console.log(`  sem movimentação .. ${candidates.length}  → candidato_exclusao`);
  console.log(`  com alguma uso .... ${review.length}  → revisar (não apaga)`);
  console.log(`Modo ................ ${dryRun ? 'DRY-RUN (só lista)' : 'EXCLUSÃO dos candidatos sem uso'}`);
  console.log('');

  let current = '';
  for (const row of listed) {
    if (row.groupKey !== current) {
      current = row.groupKey;
      const size = listed.filter((r) => r.groupKey === current).length;
      console.log(`=== ${current}  (${size} produtos) ===`);
    }
    const u = row.usage;
    const flag = row.product.isActive ? 'ativo  ' : 'inativo';
    console.log(
      `  ${pad(row.role, 5)} #${String(row.product.controlNumber).padStart(5)}  ${flag}  ` +
        `score=${String(u.score).padStart(3)} mov=${u.movimentos} vend=${u.vendas} ` +
        `ent=${u.entradas} sai=${u.saidas} sal=${u.saldo}  ${row.decision}`,
    );
    console.log(`        ${row.product.name}`);
  }

  const csvPath =
    typeof args.csv === 'string' && args.csv.trim()
      ? path.resolve(String(args.csv).trim())
      : path.join(apiRoot, 'data', `duplicados-${slug}-${by}.csv`);
  {
    const header = [
      'grupo',
      'papel',
      'decisao',
      'controlNumber',
      'id',
      'nome',
      'sku',
      'barcode',
      'ativo',
      'score',
      'movimentos',
      'vendas',
      'entradas',
      'saidas',
      'inventario',
      'reservas',
      'comandas',
      'os',
      'receitas',
      'fabrica',
      'packDeOutros',
      'saldo',
    ];
    const lines = [header.join(';')];
    for (const row of listed) {
      const u = row.usage;
      lines.push(
        [
          csvCell(row.groupKey),
          csvCell(row.role),
          csvCell(row.decision),
          row.product.controlNumber,
          csvCell(row.product.id),
          csvCell(row.product.name),
          csvCell(row.sku),
          csvCell(row.barcode),
          row.product.isActive ? 'sim' : 'nao',
          u.score,
          u.movimentos,
          u.vendas,
          u.entradas,
          u.saidas,
          u.inventario,
          u.reservas,
          u.comandas,
          u.os,
          u.receitas,
          u.fabrica,
          u.packDeOutros,
          u.saldo,
        ].join(';'),
      );
    }
    mkdirSync(path.dirname(csvPath), { recursive: true });
    writeFileSync(csvPath, `\uFEFF${lines.join('\n')}\n`, 'utf8');
    console.log('');
    console.log(`CSV gravado em ${csvPath}`);
  }

  if (dryRun) {
    console.log('');
    console.log('Nada foi excluído. Revise o CSV e, se estiver certo, rode de novo com:');
    console.log(`  npm run tenant:duplicate-products -w @gestorvend/api -- --slug ${slug} --confirm ${slug}`);
    await db.$disconnect();
    return;
  }

  console.log('');
  console.log(`Excluindo ${candidates.length} produto(s) sem movimentação...`);
  let ok = 0;
  let fail = 0;
  for (const row of candidates) {
    try {
      await db.product.delete({ where: { id: row.product.id } });
      ok += 1;
      console.log(`  OK  #${row.product.controlNumber}  ${row.product.name}`);
    } catch (err) {
      fail += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  FALHOU  #${row.product.controlNumber}  ${row.product.name}  (${msg})`);
    }
  }
  await db.$disconnect();
  console.log('');
  console.log(`Excluídos: ${ok}  |  falhas: ${fail}  |  revisões pendentes (não tocadas): ${review.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
