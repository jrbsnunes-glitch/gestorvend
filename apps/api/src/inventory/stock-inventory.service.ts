import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StockInventoryStatus,
  StockMovementSource,
  StockMovementType,
} from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

const inventoryInclude = {
  location: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          product: { select: { id: true, name: true, controlNumber: true } },
        },
      },
    },
  },
} satisfies Prisma.StockInventoryInclude;

type TenantDb = Awaited<ReturnType<TenantPrismaService['getClient']>>;

export type AddInventoryItemBody = {
  variantId?: string;
  barcode?: string | null;
  sku?: string | null;
  controlNumber?: string | number | null;
  countedQty?: string | number | null;
  notes?: string | null;
  /** Comportamento se o produto já estiver no inventário. Padrão: error. */
  onDuplicate?: 'error' | 'set' | 'increment';
};

export type CsvImportError = { line: number; reason: string; raw?: string };

@Injectable()
export class StockInventoryService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(tenantSlug: string, status?: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const where: Prisma.StockInventoryWhereInput = {};
    if (
      status === 'DRAFT' ||
      status === 'POSTED' ||
      status === 'CANCELLED'
    ) {
      where.status = status;
    }
    return db.stockInventory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        location: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });
  }

  async get(tenantSlug: string, id: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.stockInventory.findUnique({
      where: { id },
      include: inventoryInclude,
    });
    if (!row) throw new NotFoundException('Inventário não encontrado.');
    return row;
  }

  async create(
    tenantSlug: string,
    userId: string,
    body: { locationId?: string; notes?: string | null },
  ) {
    const locationId = String(body.locationId ?? '').trim();
    if (!locationId) throw new BadRequestException('Selecione o local de estoque.');
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const loc = await db.stockLocation.findUnique({ where: { id: locationId } });
    if (!loc) throw new BadRequestException('Local de estoque inválido.');

    return db.stockInventory.create({
      data: {
        locationId,
        notes: body.notes?.trim() || null,
        userId,
        status: StockInventoryStatus.DRAFT,
      },
      include: inventoryInclude,
    });
  }

  async updateHeader(
    tenantSlug: string,
    id: string,
    body: { notes?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível alterar inventário em rascunho.');
    }
    return db.stockInventory.update({
      where: { id },
      data: {
        notes: body.notes !== undefined ? body.notes?.trim() || null : undefined,
      },
      include: inventoryInclude,
    });
  }

  private parseCountedQty(
    raw: string | number | null | undefined,
  ): Prisma.Decimal | null {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException('Quantidade contada inválida.');
    }
    return new Prisma.Decimal(String(n));
  }

  /** Resolve variação por UUID, EAN, SKU ou código sequencial do produto (tenta em cascata). */
  private async resolveVariantId(
    db: TenantDb,
    body: {
      variantId?: string | null;
      barcode?: string | null;
      sku?: string | null;
      controlNumber?: string | number | null;
    },
  ): Promise<{ variantId: string; productName: string }> {
    const includeProduct = {
      product: {
        select: { name: true, stockComponentVariantId: true },
      },
    } as const;

    const variantId = String(body.variantId ?? '').trim();
    if (variantId) {
      const variant = await db.productVariant.findUnique({
        where: { id: variantId },
        include: includeProduct,
      });
      if (!variant) throw new BadRequestException('Variação inválida.');
      this.assertNotComposite(variant.product);
      return { variantId: variant.id, productName: variant.product.name };
    }

    const barcode = String(body.barcode ?? '').trim();
    if (barcode) {
      const variant = await db.productVariant.findFirst({
        where: {
          OR: [
            { barcode: { equals: barcode, mode: 'insensitive' } },
            { product: { defaultBarcode: { equals: barcode, mode: 'insensitive' } } },
          ],
        },
        include: includeProduct,
      });
      if (variant) {
        this.assertNotComposite(variant.product);
        return { variantId: variant.id, productName: variant.product.name };
      }
    }

    const sku = String(body.sku ?? '').trim();
    if (sku) {
      const variant = await db.productVariant.findFirst({
        where: { sku: { equals: sku, mode: 'insensitive' } },
        include: includeProduct,
      });
      if (variant) {
        this.assertNotComposite(variant.product);
        return { variantId: variant.id, productName: variant.product.name };
      }
    }

    const controlRaw = body.controlNumber;
    if (controlRaw != null && String(controlRaw).trim() !== '') {
      const raw = String(controlRaw).trim();
      // INT4: EANs numéricos longos não são código sequencial do produto
      const INT4_MAX = 2_147_483_647;
      const controlNumber = Number(raw);
      if (
        /^\d+$/.test(raw) &&
        raw.length <= 10 &&
        Number.isInteger(controlNumber) &&
        controlNumber >= 1 &&
        controlNumber <= INT4_MAX
      ) {
        const variants = await db.productVariant.findMany({
          where: { product: { controlNumber } },
          orderBy: { sku: 'asc' },
          take: 5,
          include: includeProduct,
        });
        if (variants.length > 0) {
          const variant = variants[0]!;
          this.assertNotComposite(variant.product);
          return { variantId: variant.id, productName: variant.product.name };
        }
      }
    }

    // Código único “livre” (coletor): tenta barcode → sku → control no mesmo valor
    const free = barcode || sku || String(controlRaw ?? '').trim();
    if (free) {
      throw new BadRequestException(`Produto não encontrado para "${free}".`);
    }

    throw new BadRequestException(
      'Informe variantId, barcode, sku ou controlNumber do produto.',
    );
  }

  private assertNotComposite(product: {
    name: string;
    stockComponentVariantId: string | null;
  }) {
    if (product.stockComponentVariantId) {
      throw new BadRequestException(
        `"${product.name}" é produto composto. Inventarie o produto unitário vinculado (estoque real), não a caixa/pack.`,
      );
    }
  }

  async addItem(tenantSlug: string, inventoryId: string, body: AddInventoryItemBody) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível incluir itens em rascunho.');
    }

    const { variantId } = await this.resolveVariantId(db, body);
    const onDuplicate = body.onDuplicate ?? 'error';

    const bal = await db.stockBalance.findUnique({
      where: {
        variantId_locationId: { variantId, locationId: inv.locationId },
      },
    });
    const systemQty = bal ? Number(bal.quantity) : 0;

    const existing = await db.stockInventoryItem.findUnique({
      where: {
        inventoryId_variantId: { inventoryId, variantId },
      },
    });

    if (existing) {
      if (onDuplicate === 'error') {
        throw new BadRequestException('Este produto já está neste inventário.');
      }

      let nextCounted: Prisma.Decimal | null;
      if (onDuplicate === 'increment') {
        const delta =
          body.countedQty != null && String(body.countedQty).trim() !== ''
            ? Number(this.parseCountedQty(body.countedQty))
            : 1;
        const prev = existing.countedQty != null ? Number(existing.countedQty) : 0;
        nextCounted = new Prisma.Decimal(String(prev + delta));
      } else {
        // set
        nextCounted =
          body.countedQty !== undefined
            ? this.parseCountedQty(body.countedQty)
            : existing.countedQty;
      }

      await db.stockInventoryItem.update({
        where: { id: existing.id },
        data: {
          countedQty: nextCounted,
          notes:
            body.notes !== undefined ? body.notes?.trim() || null : undefined,
        },
      });
      return this.get(tenantSlug, inventoryId);
    }

    let countedQty: Prisma.Decimal | null = null;
    if (body.countedQty != null && String(body.countedQty).trim() !== '') {
      countedQty = this.parseCountedQty(body.countedQty);
    } else if (onDuplicate === 'increment') {
      // Novo item em modo coletor (+1): inicia com 1
      countedQty = new Prisma.Decimal('1');
    }

    await db.stockInventoryItem.create({
      data: {
        inventoryId,
        variantId,
        systemQty: String(systemQty),
        countedQty,
        notes: body.notes?.trim() || null,
      },
    });

    return this.get(tenantSlug, inventoryId);
  }

  /**
   * Inclui em lote SKUs unitários ativos (exclui produtos compostos/caixa).
   * Já presentes no inventário são ignorados; contagem fica em branco.
   */
  async addItemsBulk(
    tenantSlug: string,
    inventoryId: string,
    body: { scope?: 'all' | 'category'; categoryId?: string | null },
  ) {
    const scope = body.scope === 'category' ? 'category' : 'all';
    const categoryId = String(body.categoryId ?? '').trim();
    if (scope === 'category' && !categoryId) {
      throw new BadRequestException('Selecione a categoria.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível incluir itens em rascunho.');
    }

    if (scope === 'category') {
      const cat = await db.category.findUnique({ where: { id: categoryId } });
      if (!cat) throw new BadRequestException('Categoria inválida.');
    }

    const variants = await db.productVariant.findMany({
      where: {
        product: {
          isActive: true,
          stockComponentVariantId: null,
          ...(scope === 'category' ? { categoryId } : {}),
        },
      },
      select: { id: true },
      orderBy: [{ product: { controlNumber: 'asc' } }, { sku: 'asc' }],
    });

    const existing = await db.stockInventoryItem.findMany({
      where: { inventoryId },
      select: { variantId: true },
    });
    const already = new Set(existing.map((e) => e.variantId));
    const toAdd = variants.filter((v) => !already.has(v.id));

    if (toAdd.length === 0) {
      return {
        inventory: await this.get(tenantSlug, inventoryId),
        summary: {
          scope,
          categoryId: scope === 'category' ? categoryId : null,
          candidates: variants.length,
          added: 0,
          skippedAlreadyInInventory: variants.length,
        },
      };
    }

    const balances = await db.stockBalance.findMany({
      where: {
        locationId: inv.locationId,
        variantId: { in: toAdd.map((v) => v.id) },
      },
      select: { variantId: true, quantity: true },
    });
    const balByVariant = new Map(
      balances.map((b) => [b.variantId, Number(b.quantity)] as const),
    );

    const chunkSize = 200;
    for (let i = 0; i < toAdd.length; i += chunkSize) {
      const chunk = toAdd.slice(i, i + chunkSize);
      await db.stockInventoryItem.createMany({
        data: chunk.map((v) => ({
          inventoryId,
          variantId: v.id,
          systemQty: String(balByVariant.get(v.id) ?? 0),
          countedQty: null,
          notes: null,
        })),
        skipDuplicates: true,
      });
    }

    return {
      inventory: await this.get(tenantSlug, inventoryId),
      summary: {
        scope,
        categoryId: scope === 'category' ? categoryId : null,
        candidates: variants.length,
        added: toAdd.length,
        skippedAlreadyInInventory: variants.length - toAdd.length,
      },
    };
  }

  async updateItem(
    tenantSlug: string,
    inventoryId: string,
    itemId: string,
    body: { countedQty?: string | number | null; notes?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível editar itens em rascunho.');
    }

    const item = await db.stockInventoryItem.findFirst({
      where: { id: itemId, inventoryId },
    });
    if (!item) throw new NotFoundException('Item não encontrado.');

    const data: Prisma.StockInventoryItemUpdateInput = {};
    if (body.countedQty !== undefined) {
      data.countedQty = this.parseCountedQty(body.countedQty);
    }
    if (body.notes !== undefined) {
      data.notes = body.notes?.trim() || null;
    }

    await db.stockInventoryItem.update({ where: { id: itemId }, data });
    return this.get(tenantSlug, inventoryId);
  }

  async removeItem(tenantSlug: string, inventoryId: string, itemId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível remover itens em rascunho.');
    }
    const item = await db.stockInventoryItem.findFirst({
      where: { id: itemId, inventoryId },
    });
    if (!item) throw new NotFoundException('Item não encontrado.');
    await db.stockInventoryItem.delete({ where: { id: itemId } });
    return this.get(tenantSlug, inventoryId);
  }

  /** CSV UTF-8 com BOM — colunas alinhadas ao import. */
  async exportCsv(tenantSlug: string, inventoryId: string): Promise<{
    filename: string;
    body: string;
  }> {
    const inv = await this.get(tenantSlug, inventoryId);
    const rows = inv.items.map((it) => ({
      barcode: it.variant.barcode ?? '',
      sku: it.variant.sku,
      controlNumber: it.variant.product.controlNumber,
      countedQty: it.countedQty != null ? String(Number(it.countedQty)) : '',
      systemQty: String(Number(it.systemQty)),
      locationCode: inv.location.code,
      productName: it.variant.product.name,
      notes: it.notes ?? '',
    }));

    const cols = [
      'barcode',
      'sku',
      'controlNumber',
      'countedQty',
      'systemQty',
      'locationCode',
      'productName',
      'notes',
    ] as const;
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [
      cols.join(','),
      ...rows.map((r) => cols.map((c) => esc(r[c])).join(',')),
    ];
    return {
      filename: `inventario-${inv.controlNumber}.csv`,
      body: '\uFEFF' + lines.join('\n'),
    };
  }

  async importCsv(
    tenantSlug: string,
    inventoryId: string,
    fileContent: string,
  ): Promise<{
    inventory: Awaited<ReturnType<StockInventoryService['get']>>;
    summary: {
      created: number;
      updated: number;
      skipped: number;
      errors: CsvImportError[];
    };
  }> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível importar contagem em rascunho.');
    }

    const text = fileContent.replace(/^\uFEFF/, '').trim();
    if (!text) throw new BadRequestException('Arquivo CSV vazio.');

    const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (rawLines.length < 2) {
      throw new BadRequestException(
        'CSV precisa de cabeçalho e ao menos uma linha de dados.',
      );
    }

    const delimiter = this.detectCsvDelimiter(rawLines[0]!);
    const headers = this.parseCsvLine(rawLines[0]!, delimiter).map((h) =>
      h.trim().toLowerCase(),
    );
    const col = (name: string) => headers.indexOf(name);

    const idxBarcode = col('barcode');
    const idxSku = col('sku');
    const idxControl = col('controlnumber');
    const idxQty = col('countedqty');
    const idxNotes = col('notes');

    if (idxQty < 0) {
      throw new BadRequestException(
        'CSV deve ter a coluna countedQty. Cabeçalho esperado: barcode,sku,controlNumber,countedQty,notes',
      );
    }
    if (idxBarcode < 0 && idxSku < 0 && idxControl < 0) {
      throw new BadRequestException(
        'CSV deve ter ao menos uma coluna de identificação: barcode, sku ou controlNumber.',
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: CsvImportError[] = [];
    /** Evita processar o mesmo variant duas vezes — última linha ganha; avisa a anterior. */
    const seenVariant = new Map<string, number>();

    for (let i = 1; i < rawLines.length; i++) {
      const lineNo = i + 1;
      const cells = this.parseCsvLine(rawLines[i]!, delimiter);
      const get = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');

      const barcode = get(idxBarcode);
      const sku = get(idxSku);
      const controlNumber = get(idxControl);
      const countedRaw = get(idxQty);
      const notes = get(idxNotes);

      if (!barcode && !sku && !controlNumber && !countedRaw) {
        skipped += 1;
        continue;
      }

      if (!barcode && !sku && !controlNumber) {
        errors.push({
          line: lineNo,
          reason: 'Informe barcode, sku ou controlNumber.',
          raw: rawLines[i],
        });
        continue;
      }

      if (countedRaw === '') {
        errors.push({
          line: lineNo,
          reason: 'countedQty obrigatório.',
          raw: rawLines[i],
        });
        continue;
      }

      let countedQty: Prisma.Decimal;
      try {
        const parsed = this.parseCountedQty(countedRaw);
        if (parsed == null) {
          errors.push({ line: lineNo, reason: 'countedQty inválido.', raw: rawLines[i] });
          continue;
        }
        countedQty = parsed;
      } catch (e) {
        errors.push({
          line: lineNo,
          reason: e instanceof Error ? e.message : 'countedQty inválido.',
          raw: rawLines[i],
        });
        continue;
      }

      let variantId: string;
      try {
        const resolved = await this.resolveVariantId(db, {
          barcode: barcode || null,
          sku: sku || null,
          controlNumber: controlNumber || null,
        });
        variantId = resolved.variantId;
      } catch (e) {
        errors.push({
          line: lineNo,
          reason: e instanceof Error ? e.message : 'Produto não encontrado.',
          raw: rawLines[i],
        });
        continue;
      }

      const prevLine = seenVariant.get(variantId);
      if (prevLine != null) {
        errors.push({
          line: prevLine,
          reason: `Produto duplicado no arquivo — sobrescrito pela linha ${lineNo}.`,
        });
      }
      seenVariant.set(variantId, lineNo);

      const bal = await db.stockBalance.findUnique({
        where: {
          variantId_locationId: { variantId, locationId: inv.locationId },
        },
      });
      const systemQty = bal ? Number(bal.quantity) : 0;

      const existing = await db.stockInventoryItem.findUnique({
        where: {
          inventoryId_variantId: { inventoryId, variantId },
        },
      });

      if (existing) {
        await db.stockInventoryItem.update({
          where: { id: existing.id },
          data: {
            countedQty,
            notes: notes || null,
          },
        });
        if (prevLine == null) updated += 1;
      } else {
        await db.stockInventoryItem.create({
          data: {
            inventoryId,
            variantId,
            systemQty: String(systemQty),
            countedQty,
            notes: notes || null,
          },
        });
        if (prevLine == null) created += 1;
        else {
          // era create na 1ª ocorrência; agora é update conceitual — ajusta contadores
          created -= 1;
          updated += 1;
        }
      }
    }

    return {
      inventory: await this.get(tenantSlug, inventoryId),
      summary: { created, updated, skipped, errors },
    };
  }

  private detectCsvDelimiter(headerLine: string): ',' | ';' {
    const semi = (headerLine.match(/;/g) ?? []).length;
    const comma = (headerLine.match(/,/g) ?? []).length;
    return semi > comma ? ';' : ',';
  }

  private parseCsvLine(line: string, delimiter: ',' | ';'): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  /** Aplica acertos ADJUST para todos os itens com contagem e fecha o inventário. */
  async post(tenantSlug: string, inventoryId: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({
      where: { id: inventoryId },
      include: { items: true, location: true },
    });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Inventário já foi postado ou cancelado.');
    }
    if (inv.items.length === 0) {
      throw new BadRequestException('Inclua ao menos 1 produto no inventário.');
    }
    const missing = inv.items.filter((it) => it.countedQty == null);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Informe a quantidade contada em todos os itens (${missing.length} pendente(s)).`,
      );
    }

    const compositeItems = await db.productVariant.findMany({
      where: {
        id: { in: inv.items.map((it) => it.variantId) },
        product: { stockComponentVariantId: { not: null } },
      },
      include: { product: { select: { name: true } } },
    });
    if (compositeItems.length > 0) {
      const names = compositeItems.map((v) => v.product.name).join(', ');
      throw new BadRequestException(
        `Remova produtos compostos do inventário antes de postar: ${names}. Inventarie o produto unitário vinculado.`,
      );
    }

    const refBase = `Inventário #${inv.controlNumber}${inv.notes ? ` — ${inv.notes}` : ''}`;

    await db.$transaction(async (tx) => {
      for (const it of inv.items) {
        const counted = Number(it.countedQty);
        const bal = await tx.stockBalance.findUnique({
          where: {
            variantId_locationId: {
              variantId: it.variantId,
              locationId: inv.locationId,
            },
          },
        });
        const systemNow = bal ? Number(bal.quantity) : 0;

        await tx.stockInventoryItem.update({
          where: { id: it.id },
          data: { systemQty: String(systemNow) },
        });

        await tx.stockBalance.upsert({
          where: {
            variantId_locationId: {
              variantId: it.variantId,
              locationId: inv.locationId,
            },
          },
          create: {
            variantId: it.variantId,
            locationId: inv.locationId,
            quantity: String(counted),
          },
          update: { quantity: String(counted) },
        });

        await tx.stockMovement.create({
          data: {
            type: StockMovementType.ADJUST,
            source: StockMovementSource.ADJUSTMENT,
            variantId: it.variantId,
            locationId: inv.locationId,
            quantity: String(counted),
            reference: refBase.slice(0, 500),
            userId,
            stockInventoryId: inv.id,
          },
        });
      }

      await tx.stockInventory.update({
        where: { id: inv.id },
        data: {
          status: StockInventoryStatus.POSTED,
          postedAt: new Date(),
        },
      });
    });

    return this.get(tenantSlug, inventoryId);
  }

  async cancel(tenantSlug: string, inventoryId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível cancelar rascunho.');
    }
    return db.stockInventory.update({
      where: { id: inventoryId },
      data: { status: StockInventoryStatus.CANCELLED },
      include: inventoryInclude,
    });
  }

  async removeDraft(tenantSlug: string, inventoryId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const inv = await db.stockInventory.findUnique({ where: { id: inventoryId } });
    if (!inv) throw new NotFoundException('Inventário não encontrado.');
    if (inv.status !== StockInventoryStatus.DRAFT) {
      throw new BadRequestException('Só é possível excluir rascunho.');
    }
    await db.stockInventory.delete({ where: { id: inventoryId } });
    return { ok: true };
  }
}
