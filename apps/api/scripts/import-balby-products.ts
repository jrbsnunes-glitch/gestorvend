/**
 * Carga dos produtos Náutica Balby (CSV do registro de inventário).
 *
 * Fonte: python apps/api/scripts/extract-balby-products.py
 *        → docs/balby/PRODUTOS NAUTICA.pdf
 *
 * Grava Product + variante (SKU = código do VR System), saldo no local MATRIZ
 * e um movimento ADJUST quando a quantidade é maior que zero.
 * Idempotente pelo SKU: atualiza nome, custo e quantidade; só grava preço de
 * venda quando o CSV traz valor > 0 (o inventário não tem tabela de venda).
 *
 * Uso (na raiz, com o Postgres no ar):
 *   npm run tenant:import-balby-products -w @gestorvend/api
 *
 * O banco padrão é gv_tenant_balby, montado a partir de TENANT_DATABASE_URL.
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import {
  PrismaClient as TenantClient,
  StockMovementSource,
  StockMovementType,
} from '../src/generated/tenant-client';
import { buildTenantDatabaseUrl } from '../src/provisioning/tenant-database-name';

/* eslint-disable no-console */

const DATABASE_NAME = 'gv_tenant_balby';
const OPENING_REF = 'SALDO-INICIAL-BALBY';

function loadEnvFile(filePath: string): void {
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
    if (isDbUrl || process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

type CsvRow = {
  nome: string;
  sku: string;
  preco: string;
  custo: string;
  quantidade: string;
  unidade: string;
};

function parseCsv(filePath: string): CsvRow[] {
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0] ?? '');
  const idx = (name: string) => header.indexOf(name);
  const iNome = idx('nome');
  const iSku = idx('sku');
  const iPreco = idx('preco_venda');
  const iCusto = idx('custo');
  const iQtd = idx('quantidade');
  const iUn = idx('unidade');
  if ([iNome, iSku, iPreco, iCusto, iQtd, iUn].some((i) => i < 0)) {
    throw new Error(`Cabeçalho inválido em ${filePath}`);
  }
  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const sku = (cols[iSku] ?? '').trim();
    const nome = (cols[iNome] ?? '').trim();
    if (!sku || !nome) continue;
    rows.push({
      nome,
      sku,
      preco: (cols[iPreco] ?? '0').trim() || '0',
      custo: (cols[iCusto] ?? '0').trim() || '0',
      quantidade: (cols[iQtd] ?? '0').trim() || '0',
      unidade: ((cols[iUn] ?? 'UN').trim() || 'UN').slice(0, 10),
    });
  }
  return rows;
}

/** CSV com separador ; e aspas opcionais. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'));
  loadEnvFile(path.join(apiRoot, '.env'));

  const template = process.env.TENANT_DATABASE_URL?.trim();
  if (!template) throw new Error('TENANT_DATABASE_URL é obrigatório no .env.');
  const tenantUrl = buildTenantDatabaseUrl(template, DATABASE_NAME);
  const csvPath = path.join(repoRoot, 'docs', 'balby', 'produtos-nautica-balby.csv');
  if (!existsSync(csvPath)) {
    throw new Error(`CSV não encontrado: ${csvPath}. Rode extract-balby-products.py antes.`);
  }

  const rows = parseCsv(csvPath);
  const db = new TenantClient({ datasources: { db: { url: tenantUrl } } });
  const location = await db.stockLocation.findUnique({ where: { code: 'MATRIZ' } });
  if (!location) {
    throw new Error('Local MATRIZ não existe. Rode o seed mínimo do tenant antes.');
  }

  let created = 0;
  let updated = 0;
  let movements = 0;
  const chunk = 80;

  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await db.$transaction(async (tx) => {
      for (const row of slice) {
        const existing = await tx.productVariant.findUnique({
          where: { sku: row.sku },
          select: { id: true, productId: true },
        });
        let variantId: string;
        if (!existing) {
          const prod = await tx.product.create({
            data: {
              name: row.nome,
              taxUnit: row.unidade,
              isService: false,
              variants: {
                create: {
                  sku: row.sku,
                  retailPrice: row.preco,
                  costAverage: row.custo,
                  minStock: '1',
                },
              },
            },
            include: { variants: { select: { id: true } } },
          });
          variantId = prod.variants[0]!.id;
          created++;
        } else {
          variantId = existing.id;
          await tx.product.update({
            where: { id: existing.productId },
            data: { name: row.nome, taxUnit: row.unidade },
          });
          const variantData: { costAverage: string; retailPrice?: string } = {
            costAverage: row.custo,
          };
          if (Number(row.preco) > 0) variantData.retailPrice = row.preco;
          await tx.productVariant.update({
            where: { id: variantId },
            data: variantData,
          });
          updated++;
        }

        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId, locationId: location.id },
          },
          create: {
            variantId,
            locationId: location.id,
            quantity: row.quantidade,
          },
          update: { quantity: row.quantidade },
        });

        const qty = Number(row.quantidade);
        if (qty > 0) {
          const already = await tx.stockMovement.findFirst({
            where: { variantId, reference: OPENING_REF },
            select: { id: true },
          });
          if (!already) {
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.ADJUST,
                source: StockMovementSource.ADJUSTMENT,
                variantId,
                locationId: location.id,
                quantity: row.quantidade,
                unitCost: row.custo,
                reference: OPENING_REF,
              },
            });
            movements++;
          }
        }
      }
    });
    console.log(`... ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }

  const products = await db.product.count();
  const balances = await db.stockBalance.count({ where: { locationId: location.id } });
  console.log(`Criados: ${created}`);
  console.log(`Atualizados: ${updated}`);
  console.log(`Movimentos de saldo inicial: ${movements}`);
  console.log(`Produtos no banco: ${products}`);
  console.log(`Saldos em MATRIZ: ${balances}`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
