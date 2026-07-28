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
import {
  AddInventoryItemBody,
  StockInventoryService,
} from './stock-inventory.service';

const CSV_UPLOAD_LIMIT = 2 * 1024 * 1024; // 2 MB

@Controller('stock-inventories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockInventoryController {
  constructor(private readonly inventories: StockInventoryService) {}

  @Get()
  @Roles('admin', 'manager', 'seller')
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.inventories.list(user.tenantSlug, status);
  }

  @Get(':id/export-csv')
  @Roles('admin', 'manager', 'seller')
  async exportCsv(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { filename, body } = await this.inventories.exportCsv(user.tenantSlug, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'seller')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.get(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: { locationId?: string; notes?: string | null },
  ) {
    return this.inventories.create(user.tenantSlug, user.sub, body);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  updateHeader(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { notes?: string | null },
  ) {
    return this.inventories.updateHeader(user.tenantSlug, id, body);
  }

  @Post(':id/import-csv')
  @Roles('admin', 'manager')
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
  ) {
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
  @Roles('admin', 'manager')
  addItemsBulk(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { scope?: 'all' | 'category'; categoryId?: string | null },
  ) {
    return this.inventories.addItemsBulk(user.tenantSlug, id, body);
  }

  @Post(':id/items')
  @Roles('admin', 'manager')
  addItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: AddInventoryItemBody,
  ) {
    return this.inventories.addItem(user.tenantSlug, id, body);
  }

  @Patch(':id/items/:itemId')
  @Roles('admin', 'manager')
  updateItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { countedQty?: string | number | null; notes?: string | null },
  ) {
    return this.inventories.updateItem(user.tenantSlug, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @Roles('admin', 'manager')
  removeItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventories.removeItem(user.tenantSlug, id, itemId);
  }

  @Post(':id/post')
  @Roles('admin', 'manager')
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.post(user.tenantSlug, id, user.sub);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.cancel(user.tenantSlug, id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.inventories.removeDraft(user.tenantSlug, id);
  }
}
