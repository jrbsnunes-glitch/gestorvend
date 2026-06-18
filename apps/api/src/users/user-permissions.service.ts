import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserPermissionCode } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ALL_PERMISSION_CODES, USER_PERMISSION_CATALOG } from './user-permissions.constants';

export type PermissionGrantInput = {
  code: UserPermissionCode;
  enabled: boolean;
  /** Nova senha ao habilitar ou trocar; vazio mantém a senha atual. */
  password?: string;
};

export type UserPermissionSummary = {
  code: UserPermissionCode;
  label: string;
  description: string;
  enabled: boolean;
  hasPassword: boolean;
};

@Injectable()
export class UserPermissionsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  isAdminRole(roles: string[]): boolean {
    return roles.includes('admin');
  }

  catalog() {
    return USER_PERMISSION_CATALOG;
  }

  async listForUser(
    tenantSlug: string,
    userId: string,
    roles: string[],
  ): Promise<{ isAdmin: boolean; permissions: UserPermissionSummary[] }> {
    if (this.isAdminRole(roles)) {
      return {
        isAdmin: true,
        permissions: USER_PERMISSION_CATALOG.map((p) => ({
          code: p.code,
          label: p.label,
          description: p.description,
          enabled: true,
          hasPassword: false,
        })),
      };
    }

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const rows = await db.userPermission.findMany({ where: { userId } });
    const byCode = new Map(rows.map((r) => [r.code, r]));

    return {
      isAdmin: false,
      permissions: USER_PERMISSION_CATALOG.map((p) => {
        const row = byCode.get(p.code);
        return {
          code: p.code,
          label: p.label,
          description: p.description,
          enabled: Boolean(row),
          hasPassword: Boolean(row?.passwordHash),
        };
      }),
    };
  }

  async updateForUser(
    tenantSlug: string,
    userId: string,
    grants: PermissionGrantInput[],
  ): Promise<UserPermissionSummary[]> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.roles.some((r) => r.name === 'admin')) {
      throw new BadRequestException('Administrador possui acesso total — permissões não se aplicam.');
    }

    for (const grant of grants) {
      if (!ALL_PERMISSION_CODES.includes(grant.code)) {
        throw new BadRequestException(`Permissão inválida: ${String(grant.code)}`);
      }

      if (!grant.enabled) {
        await db.userPermission.deleteMany({ where: { userId, code: grant.code } });
        continue;
      }

      const existing = await db.userPermission.findUnique({
        where: { userId_code: { userId, code: grant.code } },
      });

      const pwd = typeof grant.password === 'string' ? grant.password.trim() : '';
      let passwordHash = existing?.passwordHash;
      if (pwd) {
        if (pwd.length < 4) {
          throw new BadRequestException(
            `Senha da permissão «${grant.code}» precisa ter pelo menos 4 caracteres.`,
          );
        }
        passwordHash = await bcrypt.hash(pwd, 10);
      } else if (!passwordHash) {
        throw new BadRequestException(
          `Informe a senha de autorização ao conceder a permissão «${grant.code}».`,
        );
      }

      await db.userPermission.upsert({
        where: { userId_code: { userId, code: grant.code } },
        create: { userId, code: grant.code, passwordHash: passwordHash! },
        update: { passwordHash: passwordHash! },
      });
    }

    const result = await this.listForUser(tenantSlug, userId, user.roles.map((r) => r.name));
    return result.permissions;
  }

  hasPermissionEnabled(
    permissions: UserPermissionSummary[],
    code: UserPermissionCode,
  ): boolean {
    return permissions.some((p) => p.code === code && p.enabled);
  }

  /** Admin ignora; demais precisam permissão + senha correta. */
  async assertPermission(
    tenantSlug: string,
    userId: string,
    roles: string[],
    code: UserPermissionCode,
    permissionPassword?: string,
  ): Promise<void> {
    if (this.isAdminRole(roles)) return;

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const row = await db.userPermission.findUnique({
      where: { userId_code: { userId, code } },
    });
    if (!row) {
      const meta = USER_PERMISSION_CATALOG.find((p) => p.code === code);
      throw new ForbiddenException(
        meta ? `Sem permissão: ${meta.label}. Solicite ao administrador.` : 'Sem permissão.',
      );
    }

    const pwd = typeof permissionPassword === 'string' ? permissionPassword : '';
    if (!pwd.trim()) {
      throw new BadRequestException('Informe a senha de autorização para esta operação.');
    }

    const ok = await bcrypt.compare(pwd, row.passwordHash);
    if (!ok) {
      throw new ForbiddenException('Senha de autorização inválida.');
    }
  }
}
