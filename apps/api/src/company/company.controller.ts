import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { CompanyService } from './company.service';

/**
 * CRUD do cadastro da empresa (singleton por tenant).
 *
 * - Qualquer usuário autenticado pode ler (usado por cabeçalhos de impressão).
 * - Apenas Gerente/admin pode atualizar.
 */
@Controller('company')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get()
  @Roles('admin', 'manager', 'seller', 'finance')
  get(@CurrentUser() user: JwtPayload) {
    return this.company.getOrCreate(user.tenantSlug);
  }

  @Patch()
  @Roles('admin', 'manager')
  update(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return this.company.update(user.tenantSlug, body);
  }
}
