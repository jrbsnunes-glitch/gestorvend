import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { GoodsReceiptMode, Prisma } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  GoodsReceiptService,
  type PayableOptionsDto,
  type ReceiptItemDto,
} from './goods-receipt.service';

type PrismaKnown = { code: string };

function mapTenantDbError(e: unknown): never {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as PrismaKnown).code;
    if (code === 'P2021') {
      throw new ServiceUnavailableException(
        'Estrutura do banco do tenant desatualizada (tabela de entradas ausente). Rode: npm run prisma:migrate:tenant no pacote da API e garanta que o banco do tenant está apontado em TENANT_DATABASE_URL.',
      );
    }
    if (code === 'P1001' || code === 'P1017') {
      throw new ServiceUnavailableException(
        'Não foi possível conectar ao PostgreSQL do tenant. Verifique TENANT_DATABASE_URL e se o servidor de banco está em execução.',
      );
    }
  }
  throw e;
}

@Controller('goods-receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GoodsReceiptController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly goodsReceipts: GoodsReceiptService,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload, @Query('supplierId') supplierId?: string) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      const where: Prisma.GoodsReceiptWhereInput = {};
      if (supplierId != null && String(supplierId).trim() !== '') {
        where.supplierId = String(supplierId).trim();
      }
      return await db.goodsReceipt.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      return await db.goodsReceipt.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }

  @Post()
  @Roles('admin', 'manager')
  async post(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      mode: GoodsReceiptMode;
      nfeAccessKey?: string | null;
      supplierId?: string | null;
      locationId: string;
      documentNumber?: string | null;
      series?: string | null;
      issueDate?: string | null;
      natureOperation?: string | null;
      totalValue?: number | null;
      notes?: string | null;
      items: ReceiptItemDto[];
      payable?: PayableOptionsDto | null;
    },
  ) {
    return this.goodsReceipts.create(user.tenantSlug, {
      ...body,
      userId: user.sub,
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      supplierId?: string | null;
      documentNumber?: string | null;
      series?: string | null;
      issueDate?: string | null;
      natureOperation?: string | null;
      notes?: string | null;
    },
  ) {
    try {
      const db = await this.tenantPrisma.getClient(user.tenantSlug);
      return await db.goodsReceipt.update({
        where: { id },
        data: {
          supplierId: body.supplierId ?? null,
          documentNumber: body.documentNumber ?? null,
          series: body.series ?? null,
          issueDate: body.issueDate ? new Date(body.issueDate) : null,
          natureOperation: body.natureOperation ?? null,
          notes: body.notes ?? null,
        },
        include: {
          supplier: true,
          items: { include: { variant: { include: { product: true } } } },
        },
      });
    } catch (e) {
      mapTenantDbError(e);
    }
  }
}
