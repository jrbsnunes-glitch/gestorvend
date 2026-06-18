import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { UserPermissionCode } from '../generated/tenant-client';
import { UserPermissionsService } from './user-permissions.service';
import { UsersService } from './users.service';

/**
 * Apenas perfis com papel "manager" (Gerente) ou o seed "admin" podem
 * administrar usuários — incluindo criação, edição e desativação.
 * Operadores Caixa (`seller`) só podem consultar a própria identidade via /me.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly permissions: UserPermissionsService,
  ) {}

  /** Catálogo de permissões disponíveis para concessão. */
  @Get('permission-types')
  @Roles('admin', 'manager')
  permissionTypes() {
    return this.permissions.catalog();
  }

  /** Permissões do usuário logado (para UI do PDV). */
  @Get('me/permissions')
  @Roles('admin', 'manager', 'seller', 'finance')
  myPermissions(@CurrentUser() user: JwtPayload) {
    return this.permissions.listForUser(user.tenantSlug, user.sub, user.roles);
  }

  /** Identidade do usuário corrente — usada pelo front para exibir nome/perfil. */
  @Get('me')
  @Roles('admin', 'manager', 'seller', 'finance')
  async me(@CurrentUser() user: JwtPayload) {
    return this.users.getById(user.tenantSlug, user.sub);
  }

  @Get()
  @Roles('admin', 'manager')
  list(@CurrentUser() user: JwtPayload) {
    return this.users.list(user.tenantSlug);
  }

  @Get(':id/permissions')
  @Roles('admin', 'manager')
  getPermissions(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.getPermissions(user.tenantSlug, id);
  }

  @Patch(':id/permissions')
  @Roles('admin', 'manager')
  updatePermissions(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body()
    body: {
      grants?: Array<{
        code: UserPermissionCode;
        enabled: boolean;
        password?: string;
      }>;
    },
  ) {
    return this.users.updatePermissions(user.tenantSlug, id, body.grants ?? []);
  }

  @Get(':id')
  @Roles('admin', 'manager')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.getById(user.tenantSlug, id);
  }

  @Post()
  @Roles('admin', 'manager')
  create(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.users.create(user.tenantSlug, body);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.users.update(user.tenantSlug, user.sub, id, body);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.users.remove(user.tenantSlug, user.sub, id);
  }
}
