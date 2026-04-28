import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

function normDigits(s: string, maxLen: number) {
  return s.replace(/\D/g, '').slice(0, maxLen);
}

function normUnitCode(s: string) {
  return s.replace(/\s+/g, '').toUpperCase().slice(0, 10);
}

@Controller('fiscal-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalCodesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('ncm')
  @Roles('admin', 'manager', 'seller', 'finance')
  async listNcm(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    return db.ncmCode.findMany({
      where: term
        ? {
            OR: [
              { code: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: 60,
      orderBy: { code: 'asc' },
    });
  }

  @Post('ncm')
  @Roles('admin', 'manager')
  async createNcm(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; description?: string | null },
  ) {
    const code = normDigits(body.code, 8);
    if (code.length !== 8) {
      throw new BadRequestException('NCM deve ter 8 dígitos');
    }
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.ncmCode.create({
      data: {
        code,
        description: body.description?.trim() || null,
      },
    });
  }

  @Get('cest')
  @Roles('admin', 'manager', 'seller', 'finance')
  async listCest(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string,
    @Query('ncmHint') ncmHint?: string,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    const hint = normDigits(ncmHint ?? '', 8).slice(0, 4);
    const parts: Array<Record<string, unknown>> = [];
    if (term) {
      parts.push({
        OR: [
          { code: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (hint) {
      parts.push({
        OR: [{ ncmHint: null }, { ncmHint: { startsWith: hint } }],
      });
    }
    return db.cestCode.findMany({
      where: parts.length ? { AND: parts } : undefined,
      take: 60,
      orderBy: { code: 'asc' },
    });
  }

  @Post('cest')
  @Roles('admin', 'manager')
  async createCest(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; description: string; ncmHint?: string | null },
  ) {
    const code = normDigits(body.code, 7);
    if (code.length !== 7) {
      throw new BadRequestException('CEST deve ter 7 dígitos');
    }
    const description = body.description?.trim();
    if (!description) {
      throw new BadRequestException('Descrição do CEST é obrigatória.');
    }
    const hintRaw = body.ncmHint?.trim();
    const ncmHint = hintRaw ? normDigits(hintRaw, 8).slice(0, 4) || null : null;
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.cestCode.create({
      data: {
        code,
        description,
        ncmHint,
      },
    });
  }

  @Get('tax-units')
  @Roles('admin', 'manager', 'seller', 'finance')
  async listTaxUnits(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    return db.taxUnitCode.findMany({
      where: term
        ? {
            OR: [
              { code: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          }
        : undefined,
      take: 60,
      orderBy: { code: 'asc' },
    });
  }

  @Post('tax-units')
  @Roles('admin', 'manager')
  async createTaxUnit(
    @CurrentUser() user: JwtPayload,
    @Body() body: { code: string; description: string },
  ) {
    const code = normUnitCode(body.code);
    if (code.length < 1) throw new BadRequestException('Código da unidade inválido');
    const description = body.description?.trim();
    if (!description) throw new BadRequestException('Descrição da unidade é obrigatória');
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.taxUnitCode.create({
      data: { code, description },
    });
  }
}
