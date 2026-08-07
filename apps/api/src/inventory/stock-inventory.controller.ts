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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { MenuAccessService } from '../users/menu-access.service';
import {
  AddInventoryItemBody,
  StockInventoryService,
} from './stock-inventory.service';

const CSV_UPLOAD_LIMIT = 2 * 1024 * 1024; // 2 MB

function managerPasswordFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const v = (body as { managerPassword?: unknown }).managerPassword;
  return typeof v === 'string' ? v : undefined;
}

@Controller('stock-inventories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockInventoryController {
  constructor(
    private readonly inventories: StockInventoryService,
    private readonly menuAccess: MenuAccessService,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'seller')
  async list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'view',
    );
    return this.inventories.list(user.tenantSlug, status);
  }

  @Get(':id/export-csv')
  @Roles('admin', 'manager', 'seller')
  async exportCsv(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'view',
    );
    const { filename, body } = await this.inventories.exportCsv(user.tenantSlug, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller')
  async get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'view',
    );
    return this.inventories.get(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager', 'seller')
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { locationId?: string; notes?: string | null; managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'create',
      body.managerPassword,
    );
    return this.inventories.create(user.tenantSlug, user.sub, body);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'seller')
  async updateHeader(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { notes?: string | null; managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body.managerPassword,
    );
    return this.inventories.updateHeader(user.tenantSlug, id, body);
  }

  @Post(':id/import-csv')
  @Roles('admin', 'manager', 'seller')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CSV_UPLOAD_LIMIT },
    }),
  )
  async importCsv(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile()
    file: { buffer: Buffer; originalname?: string; mimetype?: string } | undefined,
    @Body() body?: { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body?.managerPassword,
    );
    if (!file?.buffer?.length) {
      throw new BadRequestException('Envie o arquivo CSV.');
    }
    const name = (file.originalname ?? '').toLowerCase();
    if (name && !name.endsWith('.csv') && !name.endsWith('.txt')) {
      throw new BadRequestException('Envie um arquivo .csv');
    }
    const content = file.buffer.toString('utf8');
    return this.inventories.importCsv(user.tenantSlug, id, content);
  }

  @Post(':id/items/bulk')
  @Roles('admin', 'manager', 'seller')
  async addItemsBulk(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      scope?: 'all' | 'category';
      categoryId?: string | null;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body.managerPassword,
    );
    return this.inventories.addItemsBulk(user.tenantSlug, id, body);
  }

  @Post(':id/items')
  @Roles('admin', 'manager', 'seller')
  async addItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: AddInventoryItemBody & { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body.managerPassword,
    );
    return this.inventories.addItem(user.tenantSlug, id, body);
  }

  @Patch(':id/items/:itemId')
  @Roles('admin', 'manager', 'seller')
  async updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body()
    body: {
      countedQty?: string | number | null;
      notes?: string | null;
      managerPassword?: string;
    },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body.managerPassword,
    );
    return this.inventories.updateItem(user.tenantSlug, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @Roles('admin', 'manager', 'seller')
  async removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body?: { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'delete',
      body?.managerPassword,
    );
    return this.inventories.removeItem(user.tenantSlug, id, itemId);
  }

  @Post(':id/post')
  @Roles('admin', 'manager', 'seller')
  async post(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'update',
      body?.managerPassword,
    );
    return this.inventories.post(user.tenantSlug, id, user.sub);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager', 'seller')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body?: { managerPassword?: string },
  ) {
    await this.menuAccess.assertMenuAction(
      user.tenantSlug,
      user.sub,
      user.roles,
      'stock',
      'delete',
      body?.managerPassword,
    );
    return this.inventories.cancel(user.tenantSlug, id);
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
      'stock',
      'delete',
      managerPasswordFrom(body),
    );
    return this.inventories.removeDraft(user.tenantSlug, id);
  }
}
