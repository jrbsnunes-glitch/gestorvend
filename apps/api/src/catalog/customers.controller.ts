import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { validateCpf11 } from '../common/cpf.util';
import { validateCnpj14 } from '../common/cnpj.util';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { MenuAccessService } from '../users/menu-access.service';
import { CustomerCreditService } from './customer-credit.service';

function normalizeDocument(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11) {
    const cpf = validateCpf11(digits);
    if (!cpf.ok) throw new BadRequestException(cpf.reason);
    return cpf.cpf;
  }
  if (digits.length === 14) {
    const cnpj = validateCnpj14(digits);
    if (!cnpj.ok) throw new BadRequestException(cnpj.reason);
    return cnpj.cnpj;
  }
  throw new BadRequestException('Documento deve ser CPF (11) ou CNPJ (14 dígitos).');
}

function parseBirthDate(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  // Aceita YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new BadRequestException('Data de nascimento inválida (use AAAA-MM-DD).');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Data de nascimento inválida.');
  return d;
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v).trim() || null;
}

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly customerCredit: CustomerCreditService,
    private readonly menuAccess: MenuAccessService,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'clients',
      'view',
    );
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.findMany({ orderBy: { name: 'asc' } });
  }

  /** Busca por nome, documento, telefone ou e-mail (PDV e cadastros). */
  @Get('search')
  @Roles('admin', 'manager', 'seller', 'finance', 'waiter', 'technician')
  async search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = (q ?? '').trim();
    if (term.length < 1) return [];

    const rows = await db.customer.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { document: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
        ],
      },
      take: 30,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, document: true, phone: true },
    });
    return this.customerCredit.enrichSearchRows(user.tenantSlug, rows);
  }

  @Get(':id/credit-summary')
  @Roles('admin', 'manager', 'seller', 'finance')
  creditSummary(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.customerCredit.getSummary(user.tenantSlug, id);
  }

  @Get(':id/credit-statement')
  @Roles('admin', 'manager', 'seller', 'finance')
  creditStatement(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    return this.customerCredit.getStatement(user.tenantSlug, id, kind ?? '');
  }

  @Get(':id/credit-adjustments')
  @Roles('admin', 'manager', 'seller', 'finance')
  creditAdjustments(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ) {
    return this.customerCredit.listAdjustments(user.tenantSlug, id, kind ?? '');
  }

  @Post(':id/credit-adjustments')
  @Roles('admin', 'manager')
  applyCreditAdjustment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      kind?: string;
      amount?: number | string;
      mode?: 'ADD' | 'SET';
    },
  ) {
    return this.customerCredit.applyAdjustment(user.tenantSlug, id, {
      kind: body.kind ?? '',
      amount: body.amount ?? 0,
      mode: body.mode === 'SET' ? 'SET' : 'ADD',
      userId: user.sub,
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.customer.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  async create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'clients',
      'create',
      typeof body.managerPassword === 'string' ? body.managerPassword : undefined,
    );
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const birthDate = parseBirthDate(body.birthDate);
    return db.customer.create({
      data: {
        name: String(body.name ?? ''),
        document: normalizeDocument(body.document),
        email: strOrNull(body.email),
        phone: strOrNull(body.phone),
        creditLimit: body.creditLimit != null ? String(body.creditLimit) : '0',
        requisitionLimit: body.requisitionLimit != null ? String(body.requisitionLimit) : '0',
        street: strOrNull(body.street),
        number: strOrNull(body.number),
        complement: strOrNull(body.complement),
        district: strOrNull(body.district),
        city: strOrNull(body.city),
        state: strOrNull(body.state)?.toUpperCase().slice(0, 2) ?? null,
        zip: body.zip ? String(body.zip).replace(/\D/g, '').slice(0, 8) || null : null,
        segment: strOrNull(body.segment),
        notes: strOrNull(body.notes),
        ...(birthDate !== undefined ? { birthDate } : {}),
      },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'seller')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'clients',
      'update',
      typeof body.managerPassword === 'string' ? body.managerPassword : undefined,
    );
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const birthDate = parseBirthDate(body.birthDate);
    return db.customer.update({
      where: { id },
      data: {
        ...(body.name != null && { name: String(body.name) }),
        ...(body.document !== undefined && { document: normalizeDocument(body.document) }),
        ...(body.email !== undefined && { email: strOrNull(body.email) }),
        ...(body.phone !== undefined && { phone: strOrNull(body.phone) }),
        ...(body.creditLimit != null && { creditLimit: String(body.creditLimit) }),
        ...(body.requisitionLimit != null && { requisitionLimit: String(body.requisitionLimit) }),
        ...(body.street !== undefined && { street: strOrNull(body.street) }),
        ...(body.number !== undefined && { number: strOrNull(body.number) }),
        ...(body.complement !== undefined && { complement: strOrNull(body.complement) }),
        ...(body.district !== undefined && { district: strOrNull(body.district) }),
        ...(body.city !== undefined && { city: strOrNull(body.city) }),
        ...(body.state !== undefined && {
          state: strOrNull(body.state)?.toUpperCase().slice(0, 2) ?? null,
        }),
        ...(body.zip !== undefined && {
          zip: body.zip ? String(body.zip).replace(/\D/g, '').slice(0, 8) || null : null,
        }),
        ...(body.segment !== undefined && { segment: strOrNull(body.segment) }),
        ...(body.notes !== undefined && { notes: strOrNull(body.notes) }),
        ...(birthDate !== undefined && { birthDate }),
      },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager', 'seller')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'clients',
      'delete',
      body?.managerPassword,
    );
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const n = await db.sale.count({ where: { customerId: id } });
    if (n > 0) {
      throw new BadRequestException('Cliente possui vendas vinculadas');
    }
    const r = await db.accountReceivable.count({ where: { customerId: id } });
    if (r > 0) {
      throw new BadRequestException('Cliente possui títulos a receber');
    }
    await db.customer.delete({ where: { id } });
    return { ok: true };
  }
}
