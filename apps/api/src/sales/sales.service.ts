import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  CardBrand,
  CardOperation,
  CardSettlementStatus,
  CashSessionStatus,
  CreditKind,
  PaymentMethod,
  Prisma,
  SaleSource,
  SaleStatus,
  ServiceTabStatus,
  StockMovementSource,
  StockMovementType,
  ActivityLogAction,
  UserPermissionCode,
} from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { CustomerCreditService } from '../catalog/customer-credit.service';
import { CompanyService } from '../company/company.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { UserPermissionsService } from '../users/user-permissions.service';
import { parseQueryDate } from '../common/date-range.util';
import { resolveSaleStockQuantity } from '../common/product-conversion.util';
import { PaymentsService } from '../payments/payments.service';
import { calcRestaurantFees } from '../restaurant/restaurant-fees';
import { maybeAutoQueueNfce } from '../fiscal/fiscal-document-queue.helper';

type TenantTx = Prisma.TransactionClient;

async function getDefaultStockLocation(db: {
  stockLocation: {
    findFirst: (args: {
      where: { isDefault: boolean };
      orderBy: Array<{ updatedAt: 'desc' } | { createdAt: 'desc' }>;
      select: { id: true; code: true; name: true };
    }) => Promise<{ id: string; code: string; name: string } | null>;
  };
}) {
  // Se houver mais de um "padrão", usa o marcado/atualizado por último.
  return db.stockLocation.findFirst({
    where: { isDefault: true },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, code: true, name: true },
  });
}

async function resolveSaleStockTarget(
  tx: TenantTx,
  soldVariantId: string,
  soldQty: number,
): Promise<{
  stockVariantId: string;
  stockQty: number;
  soldProductName: string;
  stockProductName: string;
  conversion: string | null;
}> {
  const variant = await tx.productVariant.findUniqueOrThrow({
    where: { id: soldVariantId },
    include: {
      product: {
        select: {
          name: true,
          conversion: true,
          packItemQty: true,
          stockComponentVariantId: true,
          stockComponentVariant: {
            select: { product: { select: { name: true } } },
          },
        },
      },
    },
  });
  const componentId = variant.product.stockComponentVariantId?.trim() || null;
  const stockQty = resolveSaleStockQuantity(
    soldQty,
    variant.product.conversion,
    Boolean(componentId),
    variant.product.packItemQty != null ? Number(variant.product.packItemQty) : null,
  );
  return {
    stockVariantId: componentId ?? soldVariantId,
    stockQty,
    soldProductName: variant.product.name,
    stockProductName:
      variant.product.stockComponentVariant?.product.name ?? variant.product.name,
    conversion: variant.product.conversion,
  };
}

export type CreateSaleInput = {
  tenantSlug: string;
  userId: string;
  userRoles: string[];
  permissionPassword?: string;
  customerId?: string | null;
  notes?: string | null;
  discount?: string | number;
  /** Acréscimo no total (R$) — espelha vOutro do leiaute NF-e/NFC-e. */
  surcharge?: string | number;
  /** Taxas de salão (R$) — usadas quando source=RESTAURANT; surcharge = soma. */
  serviceFeeAmount?: string | number;
  couvertAmount?: string | number;
  waiterTipAmount?: string | number;
  /** Pessoas na comanda (couvert); se omitido e RESTAURANT, usa 1 ou busca via externalRef. */
  guestCount?: number;
  /** Frete (vFrete) — soma no total da NF. */
  freightAmount?: string | number;
  /** modFrete: 0=emitente, 1=destinatário, 9=sem frete. */
  freightMod?: number;
  operationNatureId?: string | null;
  deliveryVehiclePlate?: string | null;
  deliveryDriverName?: string | null;
  /** Se false, não baixa estoque (formulário NF-e). Default true. */
  deductStock?: boolean;
  /** Origem da venda (PDV físico, WhatsApp via GestorVendChat, etc.). */
  source?: SaleSource;
  /**
   * Caixa alvo do lançamento. No PDV o front envia a sessão ativa (própria ou,
   * para gerente/admin, o caixa OPEN de outro operador). Se omitido, usa o
   * caixa aberto do próprio usuário quando existir.
   */
  cashSessionId?: string | null;
  /** Terminal PDV numerado (autoatendimento). */
  terminalId?: string | null;
  /**
   * Primeiro vencimento das parcelas de requisição. Se omitido, usa o dia do lançamento.
   * Parcelas seguintes avançam um mês a partir desta data.
   */
  requisitionDueDate?: string | Date | null;
  /** Referência externa (ex.: ID do pedido no GestorVendChat) para conciliação. */
  externalRef?: string | null;
  items: Array<{
    variantId: string;
    quantity: string | number;
    unitPrice: string | number;
    discount?: string | number;
  }>;
  payments: Array<{
    method: PaymentMethod;
    amount: string | number;
    installments?: number;
    paymentFormId?: string | null;
    authCode?: string | null;
    paymentIntentId?: string | null;
  }>;
};

const MONEY_EPS = 0.02;

function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Divide centavos sem deixar resto na última parcela. */
function splitInstallmentAmounts(total: number, installments: number): number[] {
  const n = Math.max(1, Math.floor(installments));
  const cents = Math.round(roundMoney2(total) * 100);
  const each = Math.floor(cents / n);
  const amounts: number[] = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const c = i === n - 1 ? cents - allocated : each;
    amounts.push(c / 100);
    allocated += c;
  }
  return amounts;
}

/** Primeiro vencimento da requisição: YYYY-MM-DD em horário local (sem deslocar UTC). */
function resolveRequisitionFirstDue(raw: string | Date | null | undefined): Date {
  if (raw == null || raw === '') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new BadRequestException('Vencimento inválido.');
    }
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const parsed = parseQueryDate(String(raw).trim(), 'start');
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('Vencimento inválido.');
  }
  return parsed;
}

function isCustomerCreditMethod(method: PaymentMethod): boolean {
  return method === PaymentMethod.CREDIT || method === PaymentMethod.REQUISITION;
}

function creditKindFromMethod(method: PaymentMethod): CreditKind {
  return method === PaymentMethod.REQUISITION ? CreditKind.REQUISITION : CreditKind.CREDIT;
}

type NormalizedSalePayment = {
  method: PaymentMethod;
  amount: number;
  installments: number;
  paymentFormId: string | null;
  authCode: string | null;
  paymentIntentId: string | null;
  externalTxnId: string | null;
  cardBrand: CardBrand | null;
  cardOperation: CardOperation | null;
  adminFeeAmount: number;
  netAmount: number | null;
  settlementStatus: CardSettlementStatus | null;
  expectedSettleAt: Date | null;
};

/**
 * Garante que a soma dos pagamentos gravada = total da venda.
 * Troco em dinheiro: abate o excedente dos lançamentos CASH da direita para a esquerda.
 */
export function normalizePaymentsToSaleTotal(
  payments: CreateSaleInput['payments'],
  total: number,
): Array<{
  method: PaymentMethod;
  amount: number;
  installments: number;
  paymentFormId?: string | null;
  authCode?: string | null;
  paymentIntentId?: string | null;
}> {
  for (const p of payments) {
    if (p.method === PaymentMethod.EXPENSE) {
      throw new BadRequestException('Forma de pagamento “Despesas” não se aplica a vendas.');
    }
  }
  const normalized = payments.map((p) => ({
    method: p.method,
    amount: roundMoney2(Number(p.amount)),
    installments: Math.max(1, p.installments ?? 1),
    paymentFormId: p.paymentFormId?.trim() || null,
    authCode: p.authCode?.trim() || null,
    paymentIntentId: p.paymentIntentId?.trim() || null,
  }));

  let paySum = normalized.reduce((s, p) => s + p.amount, 0);
  if (paySum + MONEY_EPS < total) {
    throw new BadRequestException('Pagamento insuficiente para o total da venda');
  }

  let excess = roundMoney2(paySum - total);
  if (excess > MONEY_EPS) {
    let toTrim = excess;
    for (let i = normalized.length - 1; i >= 0 && toTrim > MONEY_EPS; i--) {
      if (normalized[i].method !== PaymentMethod.CASH) continue;
      const cur = normalized[i].amount;
      if (cur <= MONEY_EPS) continue;
      const cut = roundMoney2(Math.min(cur, toTrim));
      normalized[i].amount = roundMoney2(cur - cut);
      toTrim = roundMoney2(toTrim - cut);
    }
    if (toTrim > MONEY_EPS) {
      throw new BadRequestException(
        'Valor pago a maior: o troco só pode ser abatido em dinheiro. Ajuste cartão, Pix, crediário ou outro.',
      );
    }
  }

  paySum = normalized.reduce((s, p) => s + p.amount, 0);
  const drift = roundMoney2(total - paySum);
  if (Math.abs(drift) > MONEY_EPS) {
    for (let i = normalized.length - 1; i >= 0; i--) {
      if (normalized[i].method !== PaymentMethod.CASH) continue;
      normalized[i].amount = roundMoney2(normalized[i].amount + drift);
      break;
    }
    paySum = normalized.reduce((s, p) => s + p.amount, 0);
  }

  if (Math.abs(paySum - total) > MONEY_EPS) {
    throw new BadRequestException('Soma dos pagamentos difere do total da venda');
  }

  for (const p of normalized) {
    if (p.amount < -MONEY_EPS) {
      throw new BadRequestException('Valor de pagamento inválido após troco');
    }
  }

  return normalized.filter((p) => p.amount > MONEY_EPS);
}

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly permissions: UserPermissionsService,
    private readonly company: CompanyService,
    private readonly customerCredit: CustomerCreditService,
    private readonly paymentsSvc: PaymentsService,
  ) {}

  async create(input: CreateSaleInput) {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    const cashSessionId = await this.resolveCashSessionIdForSale(
      db,
      input.userId,
      input.userRoles,
      input.cashSessionId,
    );

    const discount = Number(input.discount ?? 0);
    if (discount < 0 || !Number.isFinite(discount)) {
      throw new BadRequestException('Desconto inválido');
    }
    let surcharge = Number(input.surcharge ?? 0);
    if (surcharge < 0 || !Number.isFinite(surcharge)) {
      throw new BadRequestException('Acréscimo inválido');
    }
    let serviceFeeAmount = 0;
    let couvertAmount = 0;
    let waiterTipAmount = 0;
    const freightAmount = Number(input.freightAmount ?? 0);
    if (freightAmount < 0 || !Number.isFinite(freightAmount)) {
      throw new BadRequestException('Frete inválido');
    }
    let freightMod = Number(input.freightMod ?? 9);
    if (![0, 1, 2, 3, 4, 9].includes(freightMod)) freightMod = 9;
    if (freightMod === 9) {
      // Sem ocorrência de transporte: valor de frete deve ser zero
      if (freightAmount > 0.009) {
        throw new BadRequestException(
          'Com frete “sem transporte” (modFrete 9), o valor do frete deve ser zero. Escolha emitente ou destinatário.',
        );
      }
    }
    // Comanda restaurante: estoque já baixa no lançamento do item (não no PDV).
    const deductStock =
      input.source === SaleSource.RESTAURANT ? false : input.deductStock !== false;

    if (discount > 0) {
      await this.permissions.assertPermission(
        input.tenantSlug,
        input.userId,
        input.userRoles,
        UserPermissionCode.SALE_DISCOUNT,
        input.permissionPassword,
      );
    }

    let subtotal = 0;
    let itemDiscountSum = 0;
    for (const it of input.items) {
      const q = Number(it.quantity);
      const p = Number(it.unitPrice);
      const d = Number(it.discount ?? 0);
      if (q <= 0) throw new BadRequestException('Quantidade inválida');
      if (d < 0) throw new BadRequestException('Desconto de item inválido');
      const gross = roundMoney2(q * p);
      if (d > gross + 0.009) {
        throw new BadRequestException('Desconto de item não pode exceder o valor da linha.');
      }
      itemDiscountSum += d;
      subtotal += gross - d;
    }
    subtotal = roundMoney2(subtotal);
    itemDiscountSum = roundMoney2(itemDiscountSum);
    if (itemDiscountSum > 0 && discount <= 0) {
      // Desconto só em item: mesma permissão SALE_DISCOUNT.
      await this.permissions.assertPermission(
        input.tenantSlug,
        input.userId,
        input.userRoles,
        UserPermissionCode.SALE_DISCOUNT,
        input.permissionPassword,
      );
    }
    if (discount > subtotal + 0.009) {
      throw new BadRequestException('Desconto não pode ser maior que o subtotal dos produtos.');
    }

    if (input.source === SaleSource.RESTAURANT) {
      const company = await db.company.findFirst();
      let guestCount = Math.max(1, Math.floor(Number(input.guestCount ?? 1)) || 1);
      const tabRef = String(input.externalRef ?? '');
      const tabNumMatch = /^tab:(\d+)$/i.exec(tabRef);
      if (tabNumMatch) {
        const tab = await db.serviceTab.findFirst({
          where: { number: Number(tabNumMatch[1]), status: ServiceTabStatus.OPEN },
          select: { guestCount: true },
        });
        if (tab?.guestCount != null) {
          guestCount = Math.max(1, tab.guestCount);
        }
      }
      const fees = calcRestaurantFees(company, subtotal, guestCount);
      serviceFeeAmount = fees.serviceFee;
      couvertAmount = fees.couvert;
      waiterTipAmount = fees.waiterTip;
      surcharge = fees.feesTotal;
    }

    // Total mercadoria (antes do repasse de taxa de cartão).
    // MOC: vNF ≈ vProd − vDesc + vFrete + vOutro (+ seguro/impostos).
    const merchandiseTotal = roundMoney2(
      Math.max(0, subtotal - discount + surcharge + freightAmount),
    );
    if (!input.payments?.length) {
      throw new BadRequestException('Informe ao menos uma forma de pagamento');
    }
    const paymentsNorm = normalizePaymentsToSaleTotal(input.payments, merchandiseTotal);

    const intentRefs = new Map<
      string,
      { externalTxnId: string | null; authCode: string | null }
    >();
    for (const p of paymentsNorm) {
      if (!p.paymentIntentId) continue;
      const ref = await this.paymentsSvc.assertIntentForSale(
        input.tenantSlug,
        p.paymentIntentId,
        p.amount,
      );
      intentRefs.set(p.paymentIntentId, ref);
    }

    const formIds = [
      ...new Set(paymentsNorm.map((p) => p.paymentFormId).filter(Boolean) as string[]),
    ];
    const forms = formIds.length
      ? await db.paymentForm.findMany({ where: { id: { in: formIds } } })
      : [];
    const formById = new Map(forms.map((f) => [f.id, f]));

    let cardFeeSurcharge = 0;
    const paymentsToCreate: NormalizedSalePayment[] = paymentsNorm.map((p) => {
      const form = p.paymentFormId ? formById.get(p.paymentFormId) : undefined;
      if (p.paymentFormId && !form) {
        throw new BadRequestException('Forma de pagamento inválida ou inativa.');
      }
      if (form && !form.isActive) {
        throw new BadRequestException(`Forma de pagamento “${form.name}” está inativa.`);
      }
      let method = p.method;
      if (form) {
        method = form.kind as unknown as PaymentMethod;
      }
      const isCard = method === PaymentMethod.CARD;
      let amount = p.amount;
      let adminFeeAmount = 0;
      let netAmount: number | null = null;
      let cardBrand = form?.cardBrand ?? null;
      let cardOperation = form?.cardOperation ?? null;
      let settlementStatus: NormalizedSalePayment['settlementStatus'] = null;
      let expectedSettleAt: Date | null = null;
      if (isCard) {
        const feePct = Number(form?.adminFeePercent ?? 0);
        const feeFix = Number(form?.adminFeeFixed ?? 0);
        const passFee = Boolean(form?.passAdminFeeToCustomer);
        const baseAmount = amount;
        const fee = roundMoney2((baseAmount * feePct) / 100 + feeFix);
        if (passFee && fee > 0) {
          // Repasse: cliente paga base + taxa; MDR = taxa (líquido ≈ base).
          cardFeeSurcharge = roundMoney2(cardFeeSurcharge + fee);
          amount = roundMoney2(baseAmount + fee);
          adminFeeAmount = fee;
          netAmount = roundMoney2(amount - adminFeeAmount);
        } else {
          adminFeeAmount = fee;
          netAmount = roundMoney2(amount - adminFeeAmount);
        }
        if (p.paymentIntentId) {
          settlementStatus = CardSettlementStatus.SETTLED;
          expectedSettleAt = new Date();
        } else {
          settlementStatus = CardSettlementStatus.OPEN;
          const days = form?.settlementDays ?? 1;
          expectedSettleAt = new Date();
          expectedSettleAt.setDate(expectedSettleAt.getDate() + Math.max(0, days));
        }
      }
      return {
        method,
        amount,
        installments:
          method === PaymentMethod.CREDIT
            ? 1
            : isCard || method === PaymentMethod.REQUISITION
              ? Math.min(
                  Math.max(1, p.installments),
                  form?.maxInstallments ??
                    (method === PaymentMethod.REQUISITION ? 48 : p.installments),
                )
              : p.installments,
        paymentFormId: form?.id ?? null,
        authCode: p.paymentIntentId
          ? intentRefs.get(p.paymentIntentId)?.authCode ?? p.authCode ?? null
          : p.authCode ?? null,
        paymentIntentId: p.paymentIntentId ?? null,
        externalTxnId: p.paymentIntentId
          ? intentRefs.get(p.paymentIntentId)?.externalTxnId ?? null
          : null,
        cardBrand,
        cardOperation,
        adminFeeAmount,
        netAmount,
        settlementStatus,
        expectedSettleAt,
      };
    });

    const total = roundMoney2(merchandiseTotal + cardFeeSurcharge);

    const defaultLoc = await getDefaultStockLocation(db);
    const saleVariants = await db.productVariant.findMany({
      where: { id: { in: input.items.map((it) => it.variantId) } },
      select: {
        id: true,
        product: { select: { isService: true, name: true } },
      },
    });
    const serviceByVariant = new Map(
      saleVariants.map((v) => [v.id, Boolean(v.product.isService)] as const),
    );
    const needsStockDeduction =
      deductStock && saleVariants.some((v) => !v.product.isService);
    if (needsStockDeduction && !defaultLoc) {
      throw new BadRequestException('Cadastre um local de estoque padrão');
    }
    if (!deductStock && !defaultLoc) {
      // ok — sem baixa de estoque
    }

    if (input.operationNatureId) {
      const nat = await db.operationNature.findUnique({
        where: { id: input.operationNatureId },
      });
      if (!nat || !nat.isActive) {
        throw new BadRequestException('Natureza da operação inválida ou inativa.');
      }
    }

    const creditLike = paymentsToCreate.filter((p) => isCustomerCreditMethod(p.method));
    if (creditLike.length) {
      const customerId = input.customerId?.trim() || null;
      if (!customerId) {
        throw new BadRequestException(
          'Informe o cliente para finalizar venda com crediário ou requisição.',
        );
      }
      const byKind = new Map<PaymentMethod, number>();
      for (const p of creditLike) {
        byKind.set(p.method, roundMoney2((byKind.get(p.method) ?? 0) + p.amount));
      }
      for (const [method, amount] of byKind) {
        await this.customerCredit.assertAvailable(
          input.tenantSlug,
          customerId,
          creditKindFromMethod(method),
          amount,
        );
      }
    }

    return db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          status: SaleStatus.COMPLETED,
          source: input.source ?? SaleSource.PDV,
          externalRef: input.externalRef ?? null,
          customerId: input.customerId ?? null,
          userId: input.userId,
          cashSessionId,
          terminalId: input.terminalId ?? null,
          subtotal: String(subtotal.toFixed(2)),
          discount: String(discount.toFixed(2)),
          surcharge: String(surcharge.toFixed(2)),
          cardFeeSurcharge: String(cardFeeSurcharge.toFixed(2)),
          serviceFeeAmount: String(serviceFeeAmount.toFixed(2)),
          couvertAmount: String(couvertAmount.toFixed(2)),
          waiterTipAmount: String(waiterTipAmount.toFixed(2)),
          freightAmount: String(freightAmount.toFixed(2)),
          freightMod,
          operationNatureId: input.operationNatureId ?? null,
          deliveryVehiclePlate: input.deliveryVehiclePlate?.trim()
            ? String(input.deliveryVehiclePlate).trim().toUpperCase().slice(0, 10)
            : null,
          deliveryDriverName: input.deliveryDriverName?.trim()
            ? String(input.deliveryDriverName).trim().slice(0, 120)
            : null,
          deductStock,
          total: String(total.toFixed(2)),
          notes: input.notes ?? null,
          items: {
            create: input.items.map((it) => {
              const q = Number(it.quantity);
              const p = Number(it.unitPrice);
              const d = Number(it.discount ?? 0);
              const line = q * p - d;
              return {
                variantId: it.variantId,
                quantity: String(q),
                unitPrice: String(p),
                discount: String(d),
                totalLine: String(line.toFixed(2)),
              };
            }),
          },
          payments: {
            create: paymentsToCreate.map((p) => ({
              method: p.method,
              amount: String(p.amount.toFixed(2)),
              installments: p.installments,
              paymentFormId: p.paymentFormId,
              authCode: p.authCode,
              paymentIntentId: p.paymentIntentId,
              externalTxnId: p.externalTxnId,
              cardBrand: p.cardBrand,
              cardOperation: p.cardOperation,
              adminFeeAmount: String(p.adminFeeAmount.toFixed(2)),
              netAmount: p.netAmount != null ? String(p.netAmount.toFixed(2)) : null,
              settlementStatus: p.settlementStatus,
              expectedSettleAt: p.expectedSettleAt,
            })),
          },
        },
        include: { items: true, payments: { include: { paymentForm: true } } },
      });

      for (const it of input.items) {
        if (!deductStock || !defaultLoc) continue;
        if (serviceByVariant.get(it.variantId)) continue;
        const q = Number(it.quantity);
        const soldVariant = await tx.productVariant.findUnique({
          where: { id: it.variantId },
          include: {
            product: {
              include: {
                recipe: { include: { items: true } },
              },
            },
          },
        });
        if (soldVariant?.product.isService) continue;
        const recipeItems = soldVariant?.product.recipe?.items ?? [];

        if (recipeItems.length > 0) {
          // Ficha técnica (BOM): baixa insumos = qty_venda × qty_receita.
          for (const ri of recipeItems) {
            const stockQty = Math.round(q * Number(ri.quantity) * 10_000) / 10_000;
            if (stockQty <= 0) continue;
            const bal = await tx.stockBalance.findUnique({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
            });
            const current = bal ? Number(bal.quantity) : 0;
            if (current < stockQty) {
              const ing = await tx.productVariant.findUnique({
                where: { id: ri.ingredientVariantId },
                include: { product: { select: { name: true } } },
              });
              throw new BadRequestException(
                `Estoque insuficiente do insumo "${ing?.product.name ?? ri.ingredientVariantId}" (ficha técnica de "${soldVariant?.product.name}"): disponível ${current}, necessário ${stockQty}.`,
              );
            }
            const next = current - stockQty;
            await tx.stockBalance.upsert({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
              create: {
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(next),
              },
              update: { quantity: String(next) },
            });
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.OUT,
                source: StockMovementSource.SALE,
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(stockQty),
                reference: `Venda ${sale.number} (BOM)`,
                userId: input.userId,
              },
            });
          }
          continue;
        }

        const {
          stockVariantId,
          stockQty,
          soldProductName,
          stockProductName,
          conversion,
        } = await resolveSaleStockTarget(tx, it.variantId, q);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        if (current < stockQty) {
          const packHint =
            stockVariantId !== it.variantId
              ? ` Venda de "${soldProductName}"${conversion ? ` (${conversion})` : ''} baixa ${stockQty} un. de "${stockProductName}".`
              : '';
          throw new BadRequestException(
            `Estoque insuficiente de "${stockProductName}" no local ${defaultLoc.name}: disponível ${current}, necessário ${stockQty}.${packHint}`,
          );
        }
        const next = current - stockQty;
        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
          create: {
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(next),
          },
          update: { quantity: String(next) },
        });
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            source: StockMovementSource.SALE,
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(stockQty),
            reference: `Venda ${sale.number}`,
            userId: input.userId,
          },
        });
      }

      const creditLikePay = paymentsToCreate.filter((p) => isCustomerCreditMethod(p.method));
      if (creditLikePay.length) {
        const customerId = input.customerId?.trim() || null;
        if (!customerId) {
          throw new BadRequestException(
            'Informe o cliente para finalizar venda com crediário ou requisição.',
          );
        }

        // Crediário = venda à vista com saldo pré-pago: debita o saldo, sem Contas a Receber.
        const creditTotal = roundMoney2(
          creditLikePay
            .filter((p) => p.method === PaymentMethod.CREDIT)
            .reduce((s, p) => s + p.amount, 0),
        );
        if (creditTotal > 0) {
          await this.customerCredit.consumeCreditBalance(tx, customerId, creditTotal);
        }

        // Requisição continua gerando títulos a receber.
        const requisitionPay = creditLikePay.filter((p) => p.method === PaymentMethod.REQUISITION);
        if (requisitionPay.length) {
          const saleItems = await tx.saleItem.findMany({
            where: { saleId: sale.id },
            include: {
              variant: { include: { product: { select: { name: true } } } },
            },
          });
          const saleItemsTotal = saleItems.reduce((s, it) => s + Number(it.totalLine), 0) || 1;

          let reqAmount = 0;
          let reqInstallments = 1;
          for (const p of requisitionPay) {
            reqAmount = roundMoney2(reqAmount + p.amount);
            reqInstallments = Math.max(reqInstallments, Math.max(1, p.installments ?? 1));
          }

          const parcels = splitInstallmentAmounts(reqAmount, reqInstallments);
          const due = resolveRequisitionFirstDue(input.requisitionDueDate);
          for (let i = 0; i < parcels.length; i++) {
            const d = new Date(due);
            d.setMonth(d.getMonth() + i);
            const parcelStr = parcels[i].toFixed(2);
            const receivable = await tx.accountReceivable.create({
              data: {
                customerId,
                saleId: sale.id,
                description: `Requisição ${i + 1}/${parcels.length} — venda #${sale.number}`,
                amount: parcelStr,
                amountRemaining: parcelStr,
                dueDate: d,
                status: BillStatus.OPEN,
                paymentMethod: PaymentMethod.REQUISITION,
                creditKind: CreditKind.REQUISITION,
                recurrenceIndex: i + 1,
                recurrenceCount: parcels.length,
              },
            });

            let allocated = 0;
            for (let j = 0; j < saleItems.length; j++) {
              const it = saleItems[j];
              const isLast = j === saleItems.length - 1;
              const share = isLast
                ? roundMoney2(parcels[i] - allocated)
                : roundMoney2((Number(it.totalLine) / saleItemsTotal) * parcels[i]);
              allocated = roundMoney2(allocated + share);
              const qty = Number(it.quantity);
              const unit = qty > 0 ? roundMoney2(share / qty) : share;
              await tx.accountReceivableItem.create({
                data: {
                  receivableId: receivable.id,
                  description: it.variant.product?.name ?? 'Item',
                  quantity: String(it.quantity),
                  unitPrice: unit.toFixed(2),
                  totalLine: share.toFixed(2),
                },
              });
            }
          }
        }
      }

      return sale;
    }).then(async (sale) => {
      const intentIds = [
        ...new Set(
          paymentsToCreate.map((p) => p.paymentIntentId).filter(Boolean) as string[],
        ),
      ];
      for (const intentId of intentIds) {
        await this.paymentsSvc.linkIntentToSale(input.tenantSlug, intentId, sale.id);
      }
      this.activityLog.record({
        tenantSlug: input.tenantSlug,
        userId: input.userId,
        action: ActivityLogAction.RECEIPT,
        summary: `Gerou cupom — venda #${sale.number} (R$ ${Number(sale.total).toFixed(2)})`,
        entityType: 'sale',
        entityRef: `#${sale.number}`,
      });
      const db = await this.tenantPrisma.getClient(input.tenantSlug);
      const company = await db.company.findFirst({ orderBy: { createdAt: 'asc' } });
      await maybeAutoQueueNfce(db, company, sale.id);
      return sale;
    });
  }

  /**
   * Remove uma linha de item de uma venda concluída (mínimo duas linhas antes),
   * recalcula totais e rebalanceia pagamentos (mesma lógica de troco só em dinheiro).
   * Não permite com pagamento CREDIÁRIO nesta primeira versão.
   */
  async removeSaleItem(tenantSlug: string, saleId: string, saleItemId: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: true,
          payments: true,
        },
      });
      if (!sale) throw new NotFoundException('Venda não encontrada');
      if (sale.status !== SaleStatus.COMPLETED) {
        throw new BadRequestException('Só é possível retirar item de venda finalizada.');
      }
      if (sale.items.length < 2) {
        throw new BadRequestException(
          'A venda tem apenas um item. Use “Cancelar venda” integral para estornar estoque.',
        );
      }

      const hasCredit = sale.payments.some((p) => isCustomerCreditMethod(p.method));
      if (hasCredit) {
        throw new BadRequestException(
          'Remoção de item automática não disponível quando há crediário ou requisição. Cancele a venda inteira ou ajuste no financeiro.',
        );
      }

      const victim = sale.items.find((it) => it.id === saleItemId);
      if (!victim) {
        throw new BadRequestException('Item não encontrado nesta venda.');
      }

      const defaultLoc = await getDefaultStockLocation(tx);
      if (!defaultLoc) throw new BadRequestException('Local padrão não encontrado');

      const qty = Number(victim.quantity);
      const { stockVariantId, stockQty } = await resolveSaleStockTarget(tx, victim.variantId, qty);
      const bal = await tx.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
        },
      });
      const currentQty = bal ? Number(bal.quantity) : 0;
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
        },
        create: {
          variantId: stockVariantId,
          locationId: defaultLoc.id,
          quantity: String(currentQty + stockQty),
        },
        update: { quantity: String(currentQty + stockQty) },
      });
      await tx.stockMovement.create({
        data: {
          type: StockMovementType.IN,
          source: StockMovementSource.OTHER,
          variantId: stockVariantId,
          locationId: defaultLoc.id,
          quantity: String(stockQty),
          reference: `Estorno linha · venda #${sale.number}`,
          userId,
        },
      });

      await tx.saleItem.delete({ where: { id: saleItemId } });

      const remaining = sale.items.filter((it) => it.id !== saleItemId);
      const newSubtotal = roundMoney2(
        remaining.reduce((s, it) => s + Number(it.totalLine), 0),
      );
      const disc = Number(sale.discount);
      const surcharge = Number(sale.surcharge);
      let newTotal = roundMoney2(newSubtotal - disc + surcharge);
      if (newTotal < 0) {
        throw new BadRequestException(
          'Total da venda ficaria negativo com o desconto atual; reduza o desconto primeiro.',
        );
      }

      const payInput = sale.payments.map((p) => ({
        method: p.method as PaymentMethod,
        amount: Number(p.amount),
        installments: Math.max(1, p.installments ?? 1),
      }));

      let payNorm: ReturnType<typeof normalizePaymentsToSaleTotal>;
      try {
        payNorm = normalizePaymentsToSaleTotal(payInput, newTotal);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Não foi possível rebalancear os pagamentos.';
        throw new BadRequestException(msg);
      }

      await tx.salePayment.deleteMany({ where: { saleId: sale.id } });
      await tx.salePayment.createMany({
        data: payNorm.map((p) => ({
          saleId: sale.id,
          method: p.method,
          amount: String(p.amount.toFixed(2)),
          installments: p.installments,
        })),
      });

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal: String(newSubtotal.toFixed(2)),
          total: String(newTotal.toFixed(2)),
        },
        include: {
          customer: true,
          items: { include: { variant: { include: { product: true } } } },
          payments: true,
        },
      });

      return updated;
    });
  }

  /**
   * Resolve o caixa da venda: sessão explícita (gerente pode usar caixa de
   * outro operador) ou, se omitida, o caixa OPEN do próprio usuário.
   */
  private async resolveCashSessionIdForSale(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    userId: string,
    userRoles: string[],
    cashSessionId?: string | null,
  ): Promise<string | null> {
    const isManager = userRoles.includes('admin') || userRoles.includes('manager');
    const requested =
      typeof cashSessionId === 'string' && cashSessionId.trim() !== ''
        ? cashSessionId.trim()
        : null;

    if (requested) {
      const session = await db.cashRegisterSession.findUnique({ where: { id: requested } });
      if (!session) throw new NotFoundException('Caixa não encontrado.');
      if (session.status !== CashSessionStatus.OPEN) {
        throw new BadRequestException('Caixa já fechado — não é possível lançar venda nele.');
      }
      if (session.userId !== userId && !isManager) {
        throw new ForbiddenException(
          'Somente gerente pode operar o caixa aberto de outro operador.',
        );
      }
      return session.id;
    }

    const own = await db.cashRegisterSession.findFirst({
      where: { userId, status: CashSessionStatus.OPEN },
      select: { id: true },
    });
    return own?.id ?? null;
  }

  async findById(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: true,
        user: { select: { id: true, name: true, email: true } },
        fiscalDocument: true,
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundException('Venda não encontrada');
    }
    return sale;
  }

  /** Cupom não fiscal: venda + cadastro da empresa num único payload (evita race na impressão). */
  async findReceiptPrintPayload(tenantSlug: string, saleId: string) {
    const [sale, company] = await Promise.all([
      this.findById(tenantSlug, saleId),
      this.company.getOrCreate(tenantSlug),
    ]);
    return { sale, company };
  }

  async list(tenantSlug: string, from?: string, to?: string, customerId?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.SaleWhereInput = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (customerId != null && String(customerId).trim() !== '') {
      where.customerId = String(customerId).trim();
    }
    const hasDateFilter = Boolean(from || to);
    return db.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Sem filtro: últimas 100 (lista geral). Com período: até 5000 (ex.: PDV "vendas hoje").
      take: hasDateFilter ? 5000 : 100,
      include: {
        customer: true,
        fiscalDocument: true,
        items: { include: { variant: { include: { product: true } } } },
        payments: true,
      },
    });
  }

  /**
   * Baixa estoque de linhas (produto unitário / composto / ficha técnica BOM).
   * Usado pela comanda de restaurante no lançamento do item.
   */
  async consumeStockForLines(
    tenantSlug: string,
    userId: string,
    lines: Array<{ variantId: string; quantity: number }>,
    reference: string,
  ): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const defaultLoc = await getDefaultStockLocation(db);
    if (!defaultLoc) {
      throw new BadRequestException('Cadastre um local de estoque padrão');
    }
    const ref = reference.slice(0, 500);

    await db.$transaction(async (tx) => {
      for (const it of lines) {
        const q = Number(it.quantity);
        if (q <= 0) continue;
        const soldVariant = await tx.productVariant.findUnique({
          where: { id: it.variantId },
          include: {
            product: {
              include: {
                recipe: { include: { items: true } },
              },
            },
          },
        });
        const recipeItems = soldVariant?.product.recipe?.items ?? [];

        if (recipeItems.length > 0) {
          for (const ri of recipeItems) {
            const stockQty = Math.round(q * Number(ri.quantity) * 10_000) / 10_000;
            if (stockQty <= 0) continue;
            const bal = await tx.stockBalance.findUnique({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
            });
            const current = bal ? Number(bal.quantity) : 0;
            if (current < stockQty) {
              const ing = await tx.productVariant.findUnique({
                where: { id: ri.ingredientVariantId },
                include: { product: { select: { name: true } } },
              });
              throw new BadRequestException(
                `Estoque insuficiente do insumo "${ing?.product.name ?? ri.ingredientVariantId}" (ficha técnica de "${soldVariant?.product.name}"): disponível ${current}, necessário ${stockQty}.`,
              );
            }
            const next = current - stockQty;
            await tx.stockBalance.upsert({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
              create: {
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(next),
              },
              update: { quantity: String(next) },
            });
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.OUT,
                source: StockMovementSource.OTHER,
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(stockQty),
                reference: `${ref} (BOM)`,
                userId,
              },
            });
          }
          continue;
        }

        const {
          stockVariantId,
          stockQty,
          soldProductName,
          stockProductName,
          conversion,
        } = await resolveSaleStockTarget(tx, it.variantId, q);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        if (current < stockQty) {
          const packHint =
            stockVariantId !== it.variantId
              ? ` Item "${soldProductName}"${conversion ? ` (${conversion})` : ''} baixa ${stockQty} un. de "${stockProductName}".`
              : '';
          throw new BadRequestException(
            `Estoque insuficiente de "${stockProductName}" no local ${defaultLoc.name}: disponível ${current}, necessário ${stockQty}.${packHint}`,
          );
        }
        const next = current - stockQty;
        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
          create: {
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(next),
          },
          update: { quantity: String(next) },
        });
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.OUT,
            source: StockMovementSource.OTHER,
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(stockQty),
            reference: ref,
            userId,
          },
        });
      }
    });
  }

  /** Estorna baixa de estoque (cancelamento de item/comanda). Inclui BOM. */
  async restoreStockForLines(
    tenantSlug: string,
    userId: string,
    lines: Array<{ variantId: string; quantity: number }>,
    reference: string,
  ): Promise<void> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const defaultLoc = await getDefaultStockLocation(db);
    if (!defaultLoc) return;
    const ref = reference.slice(0, 500);

    await db.$transaction(async (tx) => {
      for (const it of lines) {
        const q = Number(it.quantity);
        if (q <= 0) continue;
        const soldVariant = await tx.productVariant.findUnique({
          where: { id: it.variantId },
          include: {
            product: {
              include: {
                recipe: { include: { items: true } },
              },
            },
          },
        });
        const recipeItems = soldVariant?.product.recipe?.items ?? [];

        if (recipeItems.length > 0) {
          for (const ri of recipeItems) {
            const stockQty = Math.round(q * Number(ri.quantity) * 10_000) / 10_000;
            if (stockQty <= 0) continue;
            const bal = await tx.stockBalance.findUnique({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
            });
            const current = bal ? Number(bal.quantity) : 0;
            await tx.stockBalance.upsert({
              where: {
                variantId_locationId: {
                  variantId: ri.ingredientVariantId,
                  locationId: defaultLoc.id,
                },
              },
              create: {
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(current + stockQty),
              },
              update: { quantity: String(current + stockQty) },
            });
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.IN,
                source: StockMovementSource.OTHER,
                variantId: ri.ingredientVariantId,
                locationId: defaultLoc.id,
                quantity: String(stockQty),
                reference: `${ref} (estorno BOM)`,
                userId,
              },
            });
          }
          continue;
        }

        const { stockVariantId, stockQty } = await resolveSaleStockTarget(tx, it.variantId, q);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
        });
        const current = bal ? Number(bal.quantity) : 0;
        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
          },
          create: {
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(current + stockQty),
          },
          update: { quantity: String(current + stockQty) },
        });
        await tx.stockMovement.create({
          data: {
            type: StockMovementType.IN,
            source: StockMovementSource.OTHER,
            variantId: stockVariantId,
            locationId: defaultLoc.id,
            quantity: String(stockQty),
            reference: `${ref} (estorno)`,
            userId,
          },
        });
      }
    });
  }

  async cancel(
    tenantSlug: string,
    saleId: string,
    userId: string,
    userRoles: string[],
    permissionPassword?: string,
  ) {
    await this.permissions.assertPermission(
      tenantSlug,
      userId,
      userRoles,
      UserPermissionCode.SALE_CANCEL,
      permissionPassword,
    );

    const db = await this.tenantPrisma.getClient(tenantSlug);
    return db.$transaction(async (tx) => {
      const sale = await tx.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: { items: true, payments: true },
      });
      if (sale.status === SaleStatus.CANCELLED) {
        throw new BadRequestException('Venda já cancelada');
      }

      const receivables = await tx.accountReceivable.findMany({
        where: { saleId },
        include: { settlements: { select: { id: true }, take: 1 } },
      });
      if (receivables.some((r) => r.settlements.length > 0 || Number(r.amountRemaining) < Number(r.amount) - 0.005)) {
        throw new BadRequestException(
          'Não é possível cancelar: há parcela de requisição com baixa parcial ou total. Estorne no financeiro antes.',
        );
      }

      const defaultLoc = await getDefaultStockLocation(tx);
      if (sale.deductStock) {
        if (!defaultLoc) throw new BadRequestException('Local padrão não encontrado');

        for (const it of sale.items) {
          const q = Number(it.quantity);
          const { stockVariantId, stockQty } = await resolveSaleStockTarget(tx, it.variantId, q);
          const bal = await tx.stockBalance.findUnique({
            where: {
              variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
            },
          });
          const current = bal ? Number(bal.quantity) : 0;
          await tx.stockBalance.upsert({
            where: {
              variantId_locationId: { variantId: stockVariantId, locationId: defaultLoc.id },
            },
            create: {
              variantId: stockVariantId,
              locationId: defaultLoc.id,
              quantity: String(current + stockQty),
            },
            update: { quantity: String(current + stockQty) },
          });
          await tx.stockMovement.create({
            data: {
              type: StockMovementType.IN,
              source: StockMovementSource.OTHER,
              variantId: stockVariantId,
              locationId: defaultLoc.id,
              quantity: String(stockQty),
              reference: `Estorno venda #${sale.number}`,
              userId,
            },
          });
        }
      }

      await tx.accountReceivable.deleteMany({ where: { saleId } });

      // Devolve saldo de crédito pré-pago debitado na venda.
      if (sale.customerId) {
        const creditTotal = sale.payments
          .filter((p) => p.method === PaymentMethod.CREDIT)
          .reduce((s, p) => s + Number(p.amount), 0);
        if (creditTotal > 0) {
          await this.customerCredit.restoreCreditBalance(tx, sale.customerId, creditTotal);
        }
      }

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: { status: SaleStatus.CANCELLED },
      });

      return updated;
    }).then((sale) => {
      this.activityLog.record({
        tenantSlug,
        userId,
        action: ActivityLogAction.UPDATE,
        summary: `Cancelou venda #${sale.number}`,
        entityType: 'sale',
        entityRef: `#${sale.number}`,
      });
      return sale;
    });
  }

  /** Libera novo PDV/caixa quando a pendência fiscal da venda foi resolvida manualmente (gerente). */
  async clearFiscalIntegrationError(tenantSlug: string, saleId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const sale = await db.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Venda não encontrada');
    return db.sale.update({
      where: { id: saleId },
      data: { fiscalIntegrationError: null },
    });
  }
}
