import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '../generated/tenant-client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

@Controller('fiscal-situations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FiscalSituationsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private dec(raw: unknown, label: string): Prisma.Decimal {
    const n = Number(String(raw ?? '0').replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new BadRequestException(`${label} deve ser um percentual válido entre 0 e 100.`);
    }
    return new Prisma.Decimal(String(n));
  }

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.fiscalSituation.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      code: string;
      name: string;
      description?: string | null;
      exTipi?: string | null;
      fiscalOrigin?: string | null;
      cstIcms?: string | null;
      csosn?: string | null;
      cstPis?: string | null;
      cstCofins?: string | null;
      cfopInternal?: string | null;
      cfopInterstate?: string | null;
      ibsTestRate?: number | string;
      cbsTestRate?: number | string;
      regulationNotes?: string | null;
    },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const code = String(body.code ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 48);
    if (!code) throw new BadRequestException('Informe um código.');
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Informe um nome.');
    return db.fiscalSituation.create({
      data: {
        code,
        name,
        description: body.description?.trim() ? String(body.description).trim() : null,
        exTipi: body.exTipi?.trim() ? String(body.exTipi).trim().slice(0, 10) : null,
        fiscalOrigin: body.fiscalOrigin?.trim()
          ? String(body.fiscalOrigin).trim().slice(0, 2)
          : null,
        cstIcms: body.cstIcms?.trim() ? String(body.cstIcms).trim().slice(0, 4) : null,
        csosn: body.csosn?.trim() ? String(body.csosn).trim().slice(0, 4) : null,
        cstPis: body.cstPis?.trim() ? String(body.cstPis).trim().slice(0, 4) : null,
        cstCofins: body.cstCofins?.trim() ? String(body.cstCofins).trim().slice(0, 4) : null,
        cfopInternal: body.cfopInternal?.trim()
          ? String(body.cfopInternal).trim().slice(0, 5)
          : null,
        cfopInterstate: body.cfopInterstate?.trim()
          ? String(body.cfopInterstate).trim().slice(0, 5)
          : null,
        ibsTestRate:
          body.ibsTestRate !== undefined ? this.dec(body.ibsTestRate, 'Alíquota teste IBS') : undefined,
        cbsTestRate:
          body.cbsTestRate !== undefined ? this.dec(body.cbsTestRate, 'Alíquota teste CBS') : undefined,
        regulationNotes:
          body.regulationNotes != null && String(body.regulationNotes).trim() !== ''
            ? String(body.regulationNotes).trim()
            : null,
      },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async patch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const data: Record<string, unknown> = {};
    const s = (k: string, max: number) => {
      if (body[k] === undefined) return;
      const v = body[k];
      data[k] = v === null ? null : String(v).trim().slice(0, max);
    };
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) throw new BadRequestException('Nome inválido.');
      data.name = name;
    }
    if (body.description !== undefined) {
      data.description = body.description ? String(body.description).trim() : null;
    }
    s('code', 48);
    s('exTipi', 10);
    s('fiscalOrigin', 2);
    s('cstIcms', 4);
    s('csosn', 4);
    s('cstPis', 4);
    s('cstCofins', 4);
    s('cfopInternal', 5);
    s('cfopInterstate', 5);
    if (body.ibsTestRate !== undefined)
      data.ibsTestRate = this.dec(body.ibsTestRate, 'Alíquota teste IBS');
    if (body.cbsTestRate !== undefined)
      data.cbsTestRate = this.dec(body.cbsTestRate, 'Alíquota teste CBS');
    if (body.regulationNotes !== undefined) {
      data.regulationNotes = body.regulationNotes
        ? String(body.regulationNotes).trim()
        : null;
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nada para atualizar.');
    }
    return db.fiscalSituation.update({ where: { id }, data });
  }
}
