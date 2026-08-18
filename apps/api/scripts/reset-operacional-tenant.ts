/**
 * Reset operacional de um tenant após inventário físico da loja.
 *
 * O que faz (nesta ordem, dentro de UMA transação):
 *   1. Apaga movimentação de estoque de VENDA (até a data de corte).
 *   2. Apaga comandas já fechadas que apontam para essas vendas (módulo restaurante).
 *   3. Apaga todos os títulos a receber (com baixas e itens, em cascata).
 *   4. Apaga as vendas até a data de corte — leva em cascata itens, pagamentos
 *      (inclui as transações de CARTÃO) e a fila de documento fiscal.
 *   5. Apaga todas as contas a pagar (com baixas, em cascata).
 *   6. Apaga os caixas até a data de corte — leva em cascata os movimentos de caixa.
 *   7. Apaga movimentação de estoque de ENTRADA DE NOTA (todas as datas).
 *   8. Apaga os XML de NF-e de entrada baixados da SEFAZ.
 *   9. Apaga todas as entradas de notas — leva em cascata os itens.
 *  10. Inativa os produtos com estoque zero.
 *
 * O que NÃO é tocado:
 *   - `StockBalance` (saldo atual de cada produto/local) — tabela independente, sem
 *     trigger no banco; nenhuma rotina recalcula saldo a partir de movimentação.
 *   - `SupplierProductLink` (vínculo produto × código do fornecedor).
 *   - Inventários (`StockInventory`), saídas manuais e transferências de estoque.
 *   - Cadastros (produtos, clientes, fornecedores, formas de pagamento) e logs de auditoria.
 *
 * Uso (sempre rodar o dry-run primeiro):
 *   npm run tenant:reset-operacional -w @gestorvend/api -- --slug jdn --until 2026-08-18 --dry-run
 *   npm run tenant:reset-operacional -w @gestorvend/api -- --slug jdn --until 2026-08-18 --confirm jdn
 *
 * Opções:
 *   --slug <tenant>        (obrigatório) tenant no banco central.
 *   --until YYYY-MM-DD     data de corte inclusive para vendas/caixas/cartões (default: hoje).
 *   --tz-offset ±HH:MM     fuso da loja para fechar o dia da data de corte (default: -03:00).
 *   --confirm <tenant>     repete o slug para liberar a gravação (sem isso, só dry-run).
 *   --dry-run              só conta e mostra o que seria feito.
 *   --keep-open-sessions   preserva caixas ainda ABERTOS.
 *   --skip-vendas | --skip-caixas | --skip-pagar | --skip-entradas | --skip-inativar
 *   --timeout <ms>         tempo máximo da transação (default: 900000 = 15 min).
 *
 * Variáveis: CENTRAL_DATABASE_URL, TENANT_DATABASE_URL (modelo; troca só o nome do DB).
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { PrismaClient as CentralClient } from '../src/generated/central-client';
import {
  PrismaClient as TenantClient,
  Prisma,
  CashSessionStatus,
  StockMovementSource,
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

/** Fim do dia da data de corte no fuso da loja (default Brasília). */
function endOfDay(until: string, tzOffset: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error(`--until inválido: "${until}". Use YYYY-MM-DD (ex.: 2026-08-18).`);
  }
  if (!/^[+-]\d{2}:\d{2}$/.test(tzOffset)) {
    throw new Error(`--tz-offset inválido: "${tzOffset}". Use ±HH:MM (ex.: -03:00).`);
  }
  const cutoff = new Date(`${until}T23:59:59.999${tzOffset}`);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Data de corte inválida: ${until}${tzOffset}`);
  }
  return cutoff;
}

function todayIso(tzOffset: string): string {
  const sign = tzOffset.startsWith('-') ? -1 : 1;
  const [h, m] = tzOffset.slice(1).split(':').map(Number);
  const shifted = new Date(Date.now() + sign * ((h! * 60 + m!) * 60_000));
  return shifted.toISOString().slice(0, 10);
}

function money(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Produtos cujo saldo somado em TODOS os locais é zero.
 *
 * Segue a mesma regra da listagem de produtos: quando o produto é composto
 * (caixa/pack) o estoque considerado é o da variante componente unitária,
 * não o da própria variante do pack.
 */
async function findZeroStockProducts(db: TenantClient | Prisma.TransactionClient) {
  const products = await db.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      controlNumber: true,
      stockComponentVariantId: true,
      variants: { select: { id: true } },
    },
    orderBy: { controlNumber: 'asc' },
  });

  const grouped = await db.stockBalance.groupBy({
    by: ['variantId'],
    _sum: { quantity: true },
  });
  const qtyByVariant = new Map<string, number>();
  for (const row of grouped) {
    qtyByVariant.set(row.variantId, Number(row._sum.quantity ?? 0));
  }

  const zero: { id: string; name: string; controlNumber: number }[] = [];
  for (const p of products) {
    const component = p.stockComponentVariantId?.trim();
    const stockVariantIds = component ? [component] : p.variants.map((v) => v.id);
    let total = 0;
    for (const vid of new Set(stockVariantIds)) total += qtyByVariant.get(vid) ?? 0;
    if (Math.abs(total) < 1e-6) {
      zero.push({ id: p.id, name: p.name, controlNumber: p.controlNumber });
    }
  }
  return zero;
}

async function main() {
  const apiRoot = path.join(__dirname, '..');
  const repoRoot = path.join(apiRoot, '..', '..');
  loadEnvFile(path.join(repoRoot, '.env'), { overwriteDbUrls: true });
  loadEnvFile(path.join(apiRoot, '.env'), { overwriteDbUrls: true });

  const args = parseArgs(process.argv.slice(2));
  const slug = String(args.slug ?? '').trim();
  const tzOffset = String(args['tz-offset'] ?? '-03:00').trim();
  const until = String(args.until ?? todayIso(tzOffset)).trim();
  const confirm = String(args.confirm ?? '').trim();
  const dryRun = args['dry-run'] === true || confirm === '';
  const keepOpenSessions = args['keep-open-sessions'] === true;
  const timeout = Number(args.timeout ?? 900_000);
  const steps = {
    vendas: args['skip-vendas'] !== true,
    caixas: args['skip-caixas'] !== true,
    pagar: args['skip-pagar'] !== true,
    entradas: args['skip-entradas'] !== true,
    inativar: args['skip-inativar'] !== true,
  };

  if (!slug) throw new Error('Informe --slug (ex.: --slug jdn).');
  if (!dryRun && confirm !== slug) {
    throw new Error(`--confirm precisa repetir o slug exatamente: --confirm ${slug}`);
  }
  const cutoff = endOfDay(until, tzOffset);

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

  const salesWhere = { createdAt: { lte: cutoff } };
  const sessionWhere = {
    openedAt: { lte: cutoff },
    ...(keepOpenSessions ? { status: CashSessionStatus.CLOSED } : {}),
  };

  const [
    salesCount,
    salePaymentsCount,
    cardPaymentsCount,
    saleMovesCount,
    tabsCount,
    receivablesCount,
    sessionsCount,
    openSessionsCount,
    cashMovesCount,
    payablesCount,
    receiptsCount,
    receiptMovesCount,
    inboundCount,
    balanceRows,
  ] = await Promise.all([
    db.sale.count({ where: salesWhere }),
    db.salePayment.count({ where: { sale: salesWhere } }),
    db.salePayment.count({ where: { sale: salesWhere, cardBrand: { not: null } } }),
    db.stockMovement.count({
      where: { source: StockMovementSource.SALE, createdAt: { lte: cutoff } },
    }),
    db.serviceTab.count({ where: { sale: salesWhere } }),
    db.accountReceivable.count(),
    db.cashRegisterSession.count({ where: sessionWhere }),
    db.cashRegisterSession.count({
      where: { openedAt: { lte: cutoff }, status: CashSessionStatus.OPEN },
    }),
    db.cashMovement.count({ where: { session: sessionWhere } }),
    db.accountPayable.count(),
    db.goodsReceipt.count(),
    db.stockMovement.count({ where: { source: StockMovementSource.GOODS_RECEIPT } }),
    db.inboundNfeDocument.count(),
    db.stockBalance.count(),
  ]);

  const zeroStock = steps.inativar ? await findZeroStockProducts(db) : [];
  const activeProducts = await db.product.count({ where: { isActive: true } });

  console.log('');
  console.log(`Tenant .............. ${tenant.slug} (${tenant.databaseName})`);
  console.log(`Data de corte ....... ${until} 23:59:59 ${tzOffset} (${cutoff.toISOString()})`);
  console.log(`Modo ................ ${dryRun ? 'DRY-RUN (nada será gravado)' : 'GRAVAÇÃO REAL'}`);
  console.log('');
  console.log('A apagar:');
  if (steps.vendas) {
    console.log(`  Vendas ............................ ${salesCount}`);
    console.log(`  · pagamentos (cascata) ............ ${salePaymentsCount}`);
    console.log(`  · sendo cartões .................. ${cardPaymentsCount}`);
    console.log(`  · movimentação de estoque de venda  ${saleMovesCount}`);
    console.log(`  · comandas fechadas (restaurante) . ${tabsCount}`);
    console.log(`  Títulos a receber (todos) ......... ${receivablesCount}`);
  } else {
    console.log('  Vendas ............................ PULADO (--skip-vendas)');
  }
  if (steps.caixas) {
    console.log(`  Caixas ............................ ${sessionsCount}`);
    console.log(`  · movimentos de caixa (cascata) ... ${cashMovesCount}`);
    if (openSessionsCount > 0) {
      console.log(
        keepOpenSessions
          ? `  · caixas ABERTOS preservados ...... ${openSessionsCount}`
          : `  · atenção: ${openSessionsCount} caixa(s) ABERTO(S) serão apagados`,
      );
    }
  } else {
    console.log('  Caixas ............................ PULADO (--skip-caixas)');
  }
  console.log(
    steps.pagar
      ? `  Contas a pagar (todas) ............ ${payablesCount}`
      : '  Contas a pagar .................... PULADO (--skip-pagar)',
  );
  if (steps.entradas) {
    console.log(`  Entradas de notas (todas) ......... ${receiptsCount}`);
    console.log(`  · movimentação de estoque de entrada ${receiptMovesCount}`);
    console.log(`  · XML de NF-e de entrada .......... ${inboundCount}`);
  } else {
    console.log('  Entradas de notas ................. PULADO (--skip-entradas)');
  }
  console.log('');
  console.log('A preservar:');
  console.log(`  Linhas de saldo de estoque ........ ${balanceRows} (intactas)`);
  console.log(`  Vínculos produto × fornecedor ..... ${await db.supplierProductLink.count()}`);
  console.log(`  Inventários ....................... ${await db.stockInventory.count()}`);
  console.log('');
  if (steps.inativar) {
    console.log(
      `Produtos a inativar (estoque zero) .. ${zeroStock.length} de ${activeProducts} ativos`,
    );
    for (const p of zeroStock.slice(0, 20)) {
      console.log(`  #${p.controlNumber} ${p.name}`);
    }
    if (zeroStock.length > 20) console.log(`  ... e outros ${zeroStock.length - 20}`);
  } else {
    console.log('Produtos ........................... PULADO (--skip-inativar)');
  }
  console.log('');

  if (dryRun) {
    console.log('Dry-run: nenhuma alteração gravada.');
    console.log('Antes de rodar de verdade, faça o backup deste banco:');
    console.log(
      `  pg_dump -Fc -d ${tenant.databaseName} -f ${tenant.databaseName}-${until.replace(/-/g, '')}.dump`,
    );
    console.log(`Depois execute: -- --slug ${slug} --until ${until} --confirm ${slug}`);
    await db.$disconnect();
    return;
  }

  const started = Date.now();
  const done = await db.$transaction(
    async (tx) => {
      const result: Record<string, number> = {};

      if (steps.vendas) {
        result.movimentacaoVenda = (
          await tx.stockMovement.deleteMany({
            where: { source: StockMovementSource.SALE, createdAt: { lte: cutoff } },
          })
        ).count;
        result.comandas = (await tx.serviceTab.deleteMany({ where: { sale: salesWhere } })).count;
        result.titulosReceber = (await tx.accountReceivable.deleteMany({})).count;
        result.vendas = (await tx.sale.deleteMany({ where: salesWhere })).count;
      }

      if (steps.pagar) {
        result.contasPagar = (await tx.accountPayable.deleteMany({})).count;
      }

      if (steps.caixas) {
        result.caixas = (await tx.cashRegisterSession.deleteMany({ where: sessionWhere })).count;
      }

      if (steps.entradas) {
        result.movimentacaoEntrada = (
          await tx.stockMovement.deleteMany({
            where: { source: StockMovementSource.GOODS_RECEIPT },
          })
        ).count;
        result.xmlEntrada = (await tx.inboundNfeDocument.deleteMany({})).count;
        result.entradas = (await tx.goodsReceipt.deleteMany({})).count;
      }

      if (steps.inativar) {
        // Recalcula na transação: o saldo não muda com as exclusões acima, mas
        // garante decisão sobre o estado corrente do banco.
        const zero = await findZeroStockProducts(tx);
        let inativados = 0;
        for (let i = 0; i < zero.length; i += 500) {
          const chunk = zero.slice(i, i + 500).map((p) => p.id);
          inativados += (
            await tx.product.updateMany({
              where: { id: { in: chunk }, isActive: true },
              data: { isActive: false },
            })
          ).count;
        }
        result.produtosInativados = inativados;
      }

      return result;
    },
    { timeout, maxWait: 60_000 },
  );

  const balancesAfter = await db.stockBalance.count();
  const linksAfter = await db.supplierProductLink.count();
  await db.$disconnect();

  console.log('Concluído em ' + money((Date.now() - started) / 1000) + 's:');
  for (const [k, v] of Object.entries(done)) console.log(`  ${k} .......... ${v}`);
  console.log('');
  console.log(`Saldos de estoque após .............. ${balancesAfter} (antes: ${balanceRows})`);
  console.log(`Vínculos com fornecedor após ....... ${linksAfter}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
