import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PaymentMethod, PdvTerminalMode } from '../generated/tenant-client';
import { TenantService } from '../tenant/tenant.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PdvTerminalsService } from './pdv-terminals.service';
import { PaymentsService } from '../payments/payments.service';

function assertTerminalUser(user: JwtPayload): string {
  if (user.authKind !== 'terminal' || !user.pdvTerminalId) {
    throw new ForbiddenException('Acesso restrito a terminal PDV.');
  }
  return user.pdvTerminalId;
}

@Controller('pdv-terminals')
export class PdvTerminalsController {
  constructor(
    private readonly terminals: PdvTerminalsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly tenantService: TenantService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  @Post('auth')
  async loginTerminal(
    @Body()
    body: {
      tenantSlug: string;
      terminalNumber: number;
      token: string;
    },
  ) {
    const tenantSlug = (body.tenantSlug ?? '').trim().toLowerCase();
    const terminalNumber = Math.floor(Number(body.terminalNumber));
    await this.tenantService.assertLicenseActive(tenantSlug);
    const row = await this.terminals.verifyToken(tenantSlug, terminalNumber, body.token);

    const db = await this.tenantPrisma.getClient(tenantSlug);
    let sub = row.operatorUserId;
    let email = `pdv-${row.number}@terminal.local`;
    if (sub) {
      const u = await db.user.findUnique({ where: { id: sub } });
      if (u) email = u.email;
    } else {
      const fallback = await db.user.findFirst({
        where: { isActive: true, roles: { some: { name: 'seller' } } },
        orderBy: { createdAt: 'asc' },
      });
      sub = fallback?.id ?? row.id;
      if (fallback) email = fallback.email;
    }

    const tenant = await this.tenantService.getBySlug(tenantSlug);
    const enabledModules = await this.tenantService.getEnabledModules(tenantSlug);
    const payload: JwtPayload = {
      sub,
      email,
      tenantSlug,
      roles: ['seller'],
      planCode: tenant.planCode,
      enabledModules,
      authKind: 'terminal',
      pdvTerminalId: row.id,
      pdvTerminalNumber: row.number,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(
      { sub, tenantSlug, type: 'refresh', pdvTerminalId: row.id },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES') ?? '7d',
      },
    );

    await this.terminals.touch(tenantSlug, row.id);

    return {
      accessToken,
      refreshToken,
      terminal: {
        id: row.id,
        number: row.number,
        name: row.name,
        mode: row.mode,
        allowedMethods: this.terminals.parseAllowedMethods(row.allowedMethods),
      },
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  list(@CurrentUser() user: JwtPayload) {
    return this.terminals.list(user.tenantSlug);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      number?: number;
      name: string;
      mode?: PdvTerminalMode;
      allowedMethods?: string[];
      operatorUserId?: string | null;
    },
  ) {
    return this.terminals.create(user.tenantSlug, body);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      mode?: PdvTerminalMode;
      isActive?: boolean;
      allowedMethods?: string[];
      operatorUserId?: string | null;
      mpPointTerminalId?: string | null;
    },
  ) {
    return this.terminals.update(user.tenantSlug, id, body);
  }

  @Post(':id/rotate-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  rotateToken(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.terminals.rotateToken(user.tenantSlug, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'manager')
  delete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.terminals.delete(user.tenantSlug, id);
  }
}

@Controller('kiosk')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KioskController {
  constructor(
    private readonly terminals: PdvTerminalsService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('bootstrap')
  @Roles('admin', 'manager', 'seller')
  bootstrap(@CurrentUser() user: JwtPayload) {
    return this.terminals.bootstrap(user.tenantSlug, assertTerminalUser(user));
  }

  @Get('products/search')
  @Roles('admin', 'manager', 'seller')
  async searchProducts(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    assertTerminalUser(user);
    const term = (q ?? '').trim();
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    if (!term) return [];

    const variants = await db.productVariant.findMany({
      where: {
        product: { isActive: true },
        OR: [
          { sku: { contains: term, mode: 'insensitive' } },
          { barcode: { contains: term, mode: 'insensitive' } },
          { product: { name: { contains: term, mode: 'insensitive' } } },
          ...(/^\d+$/.test(term) ? [{ product: { controlNumber: Number(term) } }] : []),
        ],
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            hasImage: true,
            imageVersion: true,
            controlNumber: true,
          },
        },
      },
      take: 40,
    });

    return variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      barcode: v.barcode,
      name: v.product.name,
      controlNumber: v.product.controlNumber,
      retailPrice: v.retailPrice.toString(),
      imageThumbUrl: v.product.hasImage
        ? `/api/catalog/${encodeURIComponent(user.tenantSlug)}/products/${encodeURIComponent(v.product.id)}/image?size=thumb&v=${v.product.imageVersion}`
        : null,
    }));
  }

  @Post('payments/point')
  @Roles('admin', 'manager', 'seller')
  createPointPayment(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      amount: number;
      paymentType: 'credit_card' | 'debit_card';
      description?: string;
    },
  ) {
    const terminalId = assertTerminalUser(user);
    return this.payments.createPointChargeForKiosk(user.tenantSlug, terminalId, body);
  }

  @Post('sales')
  @Roles('admin', 'manager', 'seller')
  completeSale(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      items: Array<{ variantId: string; quantity: number; unitPrice: number }>;
      payments: Array<{
        method: PaymentMethod;
        amount: number;
        paymentFormName?: string;
        authCode?: string | null;
        paymentIntentId?: string | null;
      }>;
      cashSessionId?: string | null;
    },
  ) {
    const terminalId = assertTerminalUser(user);
    return this.terminals.completeKioskSale(
      user.tenantSlug,
      terminalId,
      user.sub,
      user.roles,
      body,
    );
  }
}
