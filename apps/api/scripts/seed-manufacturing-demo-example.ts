/**
 * Exemplo Fábrica no tenant demo:
 * - Insumo: chapa metal estocada em m² (consumo parcial de "bobina/folha")
 * - PA: portão metálico com BOM 2,3 m² por unidade
 * - Saldo inicial 100 m² para testar reserva/baixa
 *
 * Uso: npx ts-node -r tsconfig-paths/register scripts/seed-manufacturing-demo-example.ts
 */
import { PrismaClient as TenantClient } from '../src/generated/tenant-client';

const INSUMO_SKU = 'DEMO-CHAPA-M2';
const PA_SKU = 'DEMO-PORTAO-PA';
const BOM_QTY_M2 = '2.3';
const INITIAL_STOCK_M2 = '100';

async function upsertProductWithVariant(
  tenant: TenantClient,
  data: {
    name: string;
    description: string;
    taxUnit: string;
    sku: string;
    retailPrice: string;
    costAverage: string;
    isManufacturedFinishedGood?: boolean;
    showInPublicCatalog?: boolean;
    manufacturingLeadTimeDays?: number | null;
  },
) {
  const existing = await tenant.productVariant.findUnique({
    where: { sku: data.sku },
    include: { product: true },
  });
  if (existing) {
    await tenant.product.update({
      where: { id: existing.productId },
      data: {
        name: data.name,
        description: data.description,
        taxUnit: data.taxUnit,
        isService: false,
        isManufacturedFinishedGood: Boolean(data.isManufacturedFinishedGood),
        showInPublicCatalog: Boolean(data.showInPublicCatalog),
        manufacturingLeadTimeDays: data.manufacturingLeadTimeDays ?? null,
      },
    });
    return { productId: existing.productId, variantId: existing.id };
  }

  const prod = await tenant.product.create({
    data: {
      name: data.name,
      description: data.description,
      taxUnit: data.taxUnit,
      isService: false,
      isManufacturedFinishedGood: Boolean(data.isManufacturedFinishedGood),
      showInPublicCatalog: Boolean(data.showInPublicCatalog),
      manufacturingLeadTimeDays: data.manufacturingLeadTimeDays ?? null,
      variants: {
        create: {
          sku: data.sku,
          retailPrice: data.retailPrice,
          costAverage: data.costAverage,
          minStock: '1',
        },
      },
    },
    include: { variants: true },
  });
  return { productId: prod.id, variantId: prod.variants[0]!.id };
}

async function main() {
  const tenantUrl = process.env.TENANT_DATABASE_URL;
  if (!tenantUrl) throw new Error('TENANT_DATABASE_URL é obrigatório');

  const tenant = new TenantClient({ datasources: { db: { url: tenantUrl } } });

  const location = await tenant.stockLocation.findFirst({ where: { isDefault: true } });
  if (!location) throw new Error('Local de estoque padrão não encontrado (rode o seed).');

  const insumo = await upsertProductWithVariant(tenant, {
    name: 'Chapa metal galvanizada',
    description:
      'Insumo demo: estoque em m². Simula bobina/folha 10×10 m — compras e consumo em metro quadrado, não em "1 bobina".',
    taxUnit: 'M2',
    sku: INSUMO_SKU,
    retailPrice: '0',
    costAverage: '45',
  });

  const pa = await upsertProductWithVariant(tenant, {
    name: 'Portão metálico demo',
    description: 'PA fabricável demo — consome 2,3 m² de chapa por unidade (ficha técnica).',
    taxUnit: 'UN',
    sku: PA_SKU,
    retailPrice: '2500',
    costAverage: '0',
    isManufacturedFinishedGood: true,
    showInPublicCatalog: true,
    manufacturingLeadTimeDays: 15,
  });

  await tenant.productRecipe.upsert({
    where: { productId: pa.productId },
    create: {
      productId: pa.productId,
      notes: 'Demo Fábrica: 2,3 m² de chapa por 1 portão.',
      items: {
        create: {
          ingredientVariantId: insumo.variantId,
          quantity: BOM_QTY_M2,
        },
      },
    },
    update: {
      notes: 'Demo Fábrica: 2,3 m² de chapa por 1 portão.',
      items: {
        deleteMany: {},
        create: {
          ingredientVariantId: insumo.variantId,
          quantity: BOM_QTY_M2,
        },
      },
    },
  });

  await tenant.stockBalance.upsert({
    where: {
      variantId_locationId: { variantId: insumo.variantId, locationId: location.id },
    },
    create: {
      variantId: insumo.variantId,
      locationId: location.id,
      quantity: INITIAL_STOCK_M2,
    },
    update: { quantity: INITIAL_STOCK_M2 },
  });

  const chapa = await tenant.productVariant.findUniqueOrThrow({
    where: { id: insumo.variantId },
    include: { product: { select: { controlNumber: true } } },
  });
  const portao = await tenant.productVariant.findUniqueOrThrow({
    where: { id: pa.variantId },
    include: { product: { select: { controlNumber: true } } },
  });

  // eslint-disable-next-line no-console
  console.log('');
  console.log('=== Exemplo Fábrica (tenant demo) criado/atualizado ===');
  console.log('');
  console.log('1) INSUMO (estoque em m² — consumo parcial)');
  console.log(`   Produto: Chapa metal galvanizada`);
  console.log(`   Código controle: ${chapa.product.controlNumber} | SKU: ${INSUMO_SKU}`);
  console.log(`   Unidade fiscal: M2 | Saldo inicial: ${INITIAL_STOCK_M2} m² (local ${location.code})`);
  console.log('');
  console.log('2) PRODUTO ACABADO');
  console.log(`   Produto: Portão metálico demo`);
  console.log(`   Código controle: ${portao.product.controlNumber} | SKU: ${PA_SKU}`);
  console.log(`   Flags: fabricável + catálogo público | Prazo sugerido: 15 dias`);
  console.log('');
  console.log('3) FICHA TÉCNICA (BOM)');
  console.log(`   Por 1 portão (UN): ${BOM_QTY_M2} m² de chapa`);
  console.log(`   Projeto qtd 10 → planejado ${(10 * parseFloat(BOM_QTY_M2)).toFixed(1)} m² de chapa`);
  console.log('');
  console.log('Telas: Produtos (flags) | Salão → Fichas técnicas (editar BOM) | Fábrica → Novo projeto');
  console.log(`Catálogo: http://127.0.0.1:5173/loja/demo`);
  console.log('');

  await tenant.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
