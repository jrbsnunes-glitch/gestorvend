import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, SaleSource } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SalesService } from '../sales/sales.service';

export type WaChatOrderItem = {
  /** UUID da ProductVariant no GestorVend; se ausente, use `sku`. */
  variantId?: string;
  /** SKU da variação — alternativa ao `variantId` (a bridge resolve o UUID via lookup). */
  sku?: string;
  quantity: number | string;
  unitPrice: number | string;
};

export type WaChatOrderInput = {
  tenantSlug: string;
  customerPhone?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDocument?: string | null;
  items: WaChatOrderItem[];
  paymentMethod: PaymentMethod;
  totalValue: number | string;
  deliveryAddress?: string | null;
  notes?: string | null;
  externalRef: string;
};

@Injectable()
export class WaChatService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sales: SalesService,
  ) {}

  /** Lista variações ativas para o bot oferecer no WhatsApp, com preço e estoque consolidado. */
  async getCatalog(tenantSlug: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const variants = await db.productVariant.findMany({
      where: { product: { isActive: true } },
      orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      include: {
        product: { select: { id: true, name: true, description: true, ncm: true } },
        stockBalances: { select: { quantity: true } },
      },
    });
    return variants.map((v) => {
      const stockTotal = v.stockBalances.reduce(
        (acc, b) => acc.add(b.quantity),
        new Prisma.Decimal(0),
      );
      return {
        productId: v.product.id,
        productName: v.product.name,
        description: v.product.description,
        ncm: v.product.ncm,
        variantId: v.id,
        sku: v.sku,
        barcode: v.barcode,
        retailPrice: String(v.retailPrice),
        costAverage: String(v.costAverage),
        stockTotal: stockTotal.toString(),
      };
    });
  }

  /**
   * Registra a venda já confirmada (pagamento OK no GestorVendChat) como `Sale` com
   * `source = WHATSAPP`. Se uma venda com o mesmo `externalRef` já existir, retorna ela
   * (idempotência básica).
   */
  async createOrder(input: WaChatOrderInput) {
    if (!input.items?.length) {
      throw new BadRequestException('Pedido sem itens');
    }
    if (!input.externalRef) {
      throw new BadRequestException('externalRef é obrigatório para conciliação');
    }

    const db = await this.tenantPrisma.getClient(input.tenantSlug);

    const existing = await db.sale.findFirst({
      where: { externalRef: input.externalRef, source: SaleSource.WHATSAPP },
      select: { id: true, number: true, status: true },
    });
    if (existing) {
      return { saleId: existing.id, saleNumber: existing.number, status: existing.status, deduplicated: true };
    }

    const customerId = await this.upsertCustomer(input);

    const resolvedItems = await this.resolveItemVariantIds(input.tenantSlug, input.items);

    const total = Number(input.totalValue);
    const subtotal = resolvedItems.reduce(
      (s, it) => s + Number(it.quantity) * Number(it.unitPrice),
      0,
    );
    const discount = Math.max(0, subtotal - total);

    const notesParts: string[] = [`Pedido WhatsApp ${input.externalRef}`];
    if (input.deliveryAddress) notesParts.push(`Entrega: ${input.deliveryAddress}`);
    if (input.notes) notesParts.push(input.notes);

    const sale = await this.sales.create({
      tenantSlug: input.tenantSlug,
      userId: await this.getSystemUserId(input.tenantSlug),
      customerId,
      notes: notesParts.join(' | '),
      discount,
      source: SaleSource.WHATSAPP,
      externalRef: input.externalRef,
      items: resolvedItems,
      payments: [
        {
          method: input.paymentMethod,
          amount: total,
        },
      ],
    });

    return { saleId: sale.id, saleNumber: sale.number, status: sale.status, deduplicated: false };
  }

  /**
   * Resolve cada item para um `variantId` válido (UUID da `ProductVariant`).
   * Aceita `variantId` direto OU `sku` (faz lookup pelo `sku` único).
   */
  private async resolveItemVariantIds(
    tenantSlug: string,
    items: WaChatOrderItem[],
  ): Promise<Array<{ variantId: string; quantity: number; unitPrice: number }>> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const out: Array<{ variantId: string; quantity: number; unitPrice: number }> = [];
    for (const it of items) {
      let variantId = it.variantId;
      if (!variantId && it.sku) {
        const v = await db.productVariant.findUnique({ where: { sku: it.sku }, select: { id: true } });
        if (!v) {
          throw new BadRequestException(`SKU não encontrado no GestorVend: ${it.sku}`);
        }
        variantId = v.id;
      }
      if (!variantId) {
        throw new BadRequestException('Item sem variantId nem sku — não é possível resolver no catálogo.');
      }
      out.push({
        variantId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      });
    }
    return out;
  }

  /** Localiza ou cria um cliente para vincular ao pedido (best-effort, sem quebrar a venda). */
  private async upsertCustomer(input: WaChatOrderInput): Promise<string | null> {
    const db = await this.tenantPrisma.getClient(input.tenantSlug);
    const phone = (input.customerPhone || '').replace(/\D/g, '');
    const doc = (input.customerDocument || '').replace(/\D/g, '');
    const name = (input.customerName || '').trim();

    if (!phone && !doc && !name) return null;

    if (doc) {
      const found = await db.customer.findFirst({ where: { document: doc } });
      if (found) return found.id;
    }
    if (phone) {
      const found = await db.customer.findFirst({ where: { phone } });
      if (found) return found.id;
    }

    const created = await db.customer.create({
      data: {
        name: name || `Cliente WhatsApp ${phone || ''}`.trim(),
        phone: phone || null,
        document: doc || null,
        email: input.customerEmail || null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * O `Sale.userId` é obrigatório no fluxo de cancelamento e útil para auditoria.
   * Procura um usuário com papel `admin`; se não houver, usa o primeiro usuário ativo.
   * Lança erro claro se o tenant não tem nenhum usuário, já que sem isso a venda não pode ser registrada.
   */
  private async getSystemUserId(tenantSlug: string): Promise<string> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const admin = await db.user.findFirst({
      where: { isActive: true, roles: { some: { name: 'admin' } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (admin) return admin.id;
    const any = await db.user.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!any) {
      throw new BadRequestException(
        'Tenant sem usuário ativo: cadastre ao menos um admin antes de receber pedidos do WhatsApp.',
      );
    }
    return any.id;
  }
}
