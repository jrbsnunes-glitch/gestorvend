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

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  async list(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const term = q?.trim();
    return db.category.findMany({
      where: term
        ? { name: { contains: term, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
      take: term ? 80 : 60,
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller', 'finance')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.category.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  @Roles('admin', 'manager')
  async create(@CurrentUser() user: JwtPayload, @Body() body: { name: string; parentId?: string | null }) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.category.create({
      data: {
        name: body.name,
        parentId: body.parentId ?? null,
      },
    });
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { name?: string; parentId?: string | null },
  ) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    return db.category.update({
      where: { id },
      data: {
        ...(body.name != null && { name: body.name }),
        ...(body.parentId !== undefined && { parentId: body.parentId }),
      },
    });
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const db = await this.tenantPrisma.getClient(user.tenantSlug);
    const child = await db.category.count({ where: { parentId: id } });
    if (child > 0) throw new BadRequestException('Categoria possui subcategorias');
    const pr = await db.product.count({ where: { categoryId: id } });
    if (pr > 0) throw new BadRequestException('Categoria possui produtos');
    await db.category.delete({ where: { id } });
    return { ok: true };
  }
}
