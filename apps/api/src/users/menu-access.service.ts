import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  MENU_ACCESS_CATALOG,
  MENU_ACCESS_KEYS,
  defaultCashierMenuAccess,
  type MenuAccessAction,
  type MenuAccessFlags,
} from './menu-access.constants';

export type MenuAccessGrantInput = {
  menuKey: string;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type MenuAccessMatrixResponse = {
  isFullAccess: boolean;
  menus: Array<
    MenuAccessFlags & {
      label: string;
      supportsMutations: boolean;
      supportsDelete: boolean;
    }
  >;
};

@Injectable()
export class MenuAccessService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  isManagerOrAdmin(roles: string[]): boolean {
    return roles.includes('admin') || roles.includes('manager');
  }

  catalog() {
    return MENU_ACCESS_CATALOG.map((m) => ({
      key: m.key,
      label: m.label,
      supportsMutations: m.supportsMutations !== false,
      supportsDelete: Boolean(m.supportsDelete),
    }));
  }

  async listForUser(
    tenantSlug: string,
    userId: string,
    roles: string[],
  ): Promise<MenuAccessMatrixResponse> {
    if (this.isManagerOrAdmin(roles)) {
      return {
        isFullAccess: true,
        menus: MENU_ACCESS_CATALOG.map((m) => ({
          menuKey: m.key,
          label: m.label,
          supportsMutations: m.supportsMutations !== false,
          supportsDelete: Boolean(m.supportsDelete),
          canView: true,
          canCreate: true,
          canUpdate: true,
          canDelete: true,
        })),
      };
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.menuAccessGrant.findMany({ where: { userId } });
    const byKey = new Map(rows.map((r) => [r.menuKey, r]));

    return {
      isFullAccess: false,
      menus: MENU_ACCESS_CATALOG.map((m) => {
        const row = byKey.get(m.key);
        const base = row
          ? {
              menuKey: m.key,
              canView: row.canView,
              canCreate: row.canCreate,
              canUpdate: row.canUpdate,
              canDelete: row.canDelete,
            }
          : defaultCashierMenuAccess(m.key);
        return {
          ...base,
          label: m.label,
          supportsMutations: m.supportsMutations !== false,
          supportsDelete: Boolean(m.supportsDelete),
        };
      }),
    };
  }

  async updateForUser(
    tenantSlug: string,
    actorRoles: string[],
    userId: string,
    grants: MenuAccessGrantInput[],
  ): Promise<MenuAccessMatrixResponse> {
    if (!this.isManagerOrAdmin(actorRoles)) {
      throw new ForbiddenException('Somente o gerente pode alterar permissões de acesso.');
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const targetRoles = user.roles.map((r) => r.name);
    if (this.isManagerOrAdmin(targetRoles)) {
      throw new BadRequestException(
        'Gerente/administrador possui acesso total — permissões de menu não se aplicam.',
      );
    }

    for (const g of grants) {
      if (!MENU_ACCESS_KEYS.includes(g.menuKey)) {
        throw new BadRequestException(`Menu inválido: ${g.menuKey}`);
      }
      const meta = MENU_ACCESS_CATALOG.find((m) => m.key === g.menuKey)!;
      const canCreate = meta.supportsMutations === false ? false : Boolean(g.canCreate);
      const canUpdate = meta.supportsMutations === false ? false : Boolean(g.canUpdate);
      const canDelete = meta.supportsDelete ? Boolean(g.canDelete) : false;

      await db.menuAccessGrant.upsert({
        where: { userId_menuKey: { userId, menuKey: g.menuKey } },
        create: {
          userId,
          menuKey: g.menuKey,
          canView: Boolean(g.canView),
          canCreate,
          canUpdate,
          canDelete,
        },
        update: {
          canView: Boolean(g.canView),
          canCreate,
          canUpdate,
          canDelete,
        },
      });
    }

    return this.listForUser(tenantSlug, userId, targetRoles);
  }

  async getFlags(
    tenantSlug: string,
    userId: string,
    roles: string[],
    menuKey: string,
  ): Promise<MenuAccessFlags> {
    if (this.isManagerOrAdmin(roles)) {
      return {
        menuKey,
        canView: true,
        canCreate: true,
        canUpdate: true,
        canDelete: true,
      };
    }
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.menuAccessGrant.findUnique({
      where: { userId_menuKey: { userId, menuKey } },
    });
    if (row) {
      return {
        menuKey,
        canView: row.canView,
        canCreate: row.canCreate,
        canUpdate: row.canUpdate,
        canDelete: row.canDelete,
      };
    }
    return defaultCashierMenuAccess(menuKey);
  }

  /** Valida senha de qualquer usuário ativo com perfil gerente/admin. */
  async verifyManagerPassword(tenantSlug: string, password: string): Promise<void> {
    const pwd = typeof password === 'string' ? password.trim() : '';
    if (!pwd) {
      throw new BadRequestException('Informe a senha do gerente para autorizar esta operação.');
    }
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const managers = await db.user.findMany({
      where: {
        isActive: true,
        roles: { some: { name: { in: ['admin', 'manager'] } } },
      },
      select: { passwordHash: true },
    });
    if (!managers.length) {
      throw new ForbiddenException('Não há gerente ativo para autorizar esta operação.');
    }
    for (const m of managers) {
      if (await bcrypt.compare(pwd, m.passwordHash)) return;
    }
    throw new ForbiddenException('Senha do gerente inválida.');
  }

  /**
   * Gerente/admin: libera.
   * Caixa com flag true: libera sem senha.
   * Caixa com flag false: exige senha do gerente.
   */
  async assertMenuAction(
    tenantSlug: string,
    userId: string,
    roles: string[],
    menuKey: string,
    action: MenuAccessAction,
    managerPassword?: string,
  ): Promise<void> {
    if (this.isManagerOrAdmin(roles)) return;
    if (!MENU_ACCESS_KEYS.includes(menuKey)) {
      throw new BadRequestException(`Menu inválido: ${menuKey}`);
    }

    const flags = await this.getFlags(tenantSlug, userId, roles, menuKey);
    const allowed =
      action === 'view'
        ? flags.canView
        : action === 'create'
          ? flags.canCreate
          : action === 'update'
            ? flags.canUpdate
            : flags.canDelete;

    if (allowed) return;

    const meta = MENU_ACCESS_CATALOG.find((m) => m.key === menuKey);
    const actionLabel =
      action === 'view'
        ? 'visualizar'
        : action === 'create'
          ? 'incluir'
          : action === 'update'
            ? 'alterar'
            : 'excluir';

    if (action === 'view') {
      throw new ForbiddenException(
        meta
          ? `Sem permissão para acessar «${meta.label}». Solicite ao gerente.`
          : 'Sem permissão de acesso.',
      );
    }

    // Ação bloqueada: sobe com senha do gerente.
    try {
      await this.verifyManagerPassword(tenantSlug, managerPassword ?? '');
    } catch (e) {
      if (e instanceof BadRequestException && !(managerPassword ?? '').trim()) {
        throw new BadRequestException(
          `Sem permissão para ${actionLabel} em «${meta?.label ?? menuKey}». Informe a senha do gerente.`,
        );
      }
      throw e;
    }
  }
}
