import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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

@Controller('operation-natures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationNaturesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private normalizeCfop(raw: unknown): string {
    const cfop = String(raw ?? '').replace(/\D/g, '').slice(0, 4);
    if (cfop.length !== 4) {
      throw new BadRequestException('CFOP deve ter 4 dígitos.');
    }
    return cfop;
  }

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    return db.operationNature.findMany({
      where: term
        ? {
            OR: [
              { code: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { cfop: { contains: term.replace(/\D/g, '') } },
            ],
          }
        : undefined,
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      take: term ? 80 : undefined,
    });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const code = String(body.code ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 20);
    if (!code) throw new BadRequestException('Informe o código.');
    const description = String(body.description ?? '').trim().slice(0, 60);
    if (!description) throw new BadRequestException('Informe a descrição (natureza da operação).');
    const cfop = this.normalizeCfop(body.cfop);
    return db.operationNature.create({
      data: {
        code,
        description,
        cfop,
        notes: body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null,
        isActive: body.isActive === false || body.isActive === 'false' ? false : true,
      },
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.operationNature.findUniqueOrThrow({ where: { id } });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const data: Record<string, unknown> = {};
    if (body.code !== undefined) {
      const code = String(body.code ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 20);
      if (!code) throw new BadRequestException('Código inválido.');
      data.code = code;
    }
    if (body.description !== undefined) {
      const description = String(body.description ?? '').trim().slice(0, 60);
      if (!description) throw new BadRequestException('Descrição inválida.');
      data.description = description;
    }
    if (body.cfop !== undefined) data.cfop = this.normalizeCfop(body.cfop);
    if (body.notes !== undefined) {
      data.notes =
        body.notes == null || String(body.notes).trim() === ''
          ? null
          : String(body.notes).trim();
    }
    if (body.isActive !== undefined) {
      data.isActive = !(body.isActive === false || body.isActive === 'false');
    }
    return db.operationNature.update({ where: { id }, data });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const n = await db.sale.count({ where: { operationNatureId: id } });
    if (n > 0) {
      throw new BadRequestException(
        'Natureza vinculada a vendas/NF-e. Desative-a em vez de excluir.',
      );
    }
    await db.operationNature.delete({ where: { id } });
    return { ok: true };
  }
}
