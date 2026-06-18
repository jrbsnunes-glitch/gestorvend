import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserPermissionCode } from '../generated/tenant-client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PermissionGrantInput, UserPermissionsService } from './user-permissions.service';

/**
 * Perfis expostos ao usuário final no UI.
 * Mapeiam diretamente para roles do RBAC interno:
 *  - manager  → acesso total (gerencia cadastros e usuários)
 *  - cashier  → role interna `seller` (operação no PDV)
 */
export type UserProfile = 'manager' | 'cashier';

const PROFILE_TO_ROLE: Record<UserProfile, string> = {
  manager: 'manager',
  cashier: 'seller',
};

export type UserSummary = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  profile: UserProfile;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly permissions: UserPermissionsService,
  ) {}

  /**
   * Converte o conjunto de roles persistidas num único perfil "amigável".
   * Quando o usuário acumula múltiplas roles internas (ex.: seed admin), o
   * perfil exibido prioriza gerente.
   */
  private toProfile(roles: { name: string }[]): UserProfile {
    const names = roles.map((r) => r.name);
    if (names.includes('admin') || names.includes('manager')) return 'manager';
    return 'cashier';
  }

  private toSummary(user: {
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    roles: { name: string }[];
  }): UserSummary {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      profile: this.toProfile(user.roles),
      roles: user.roles.map((r) => r.name),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private validateProfile(value: unknown): UserProfile {
    if (value === 'manager' || value === 'cashier') return value;
    throw new BadRequestException('Perfil inválido. Use "manager" ou "cashier".');
  }

  private validateEmail(value: unknown): string {
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new BadRequestException('Informe um e-mail válido.');
    }
    return value.toLowerCase();
  }

  private validateName(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 2) {
      throw new BadRequestException('Informe um nome com pelo menos 2 caracteres.');
    }
    return value.trim();
  }

  private validatePassword(value: unknown): string {
    if (typeof value !== 'string' || value.length < 6) {
      throw new BadRequestException('A senha precisa ter pelo menos 6 caracteres.');
    }
    return value;
  }

  /**
   * Resolve a role do banco a partir do perfil de UI, criando-a caso ainda não
   * exista (importante quando bancos antigos não passaram pelo seed atual).
   */
  private async resolveRole(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    profile: UserProfile,
  ) {
    const name = PROFILE_TO_ROLE[profile];
    return db.role.upsert({
      where: { name },
      create: { name },
      update: {},
    });
  }

  async list(tenantSlug: string): Promise<UserSummary[]> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const users = await db.user.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { roles: true },
    });
    return users.map((u) => this.toSummary(u));
  }

  async getById(tenantSlug: string, id: string): Promise<UserSummary> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const u = await db.user.findUnique({ where: { id }, include: { roles: true } });
    if (!u) throw new NotFoundException('Usuário não encontrado.');
    return this.toSummary(u);
  }

  async create(
    tenantSlug: string,
    body: {
      name?: unknown;
      email?: unknown;
      password?: unknown;
      profile?: unknown;
    },
  ): Promise<UserSummary> {
    const name = this.validateName(body.name);
    const email = this.validateEmail(body.email);
    const password = this.validatePassword(body.password);
    const profile = this.validateProfile(body.profile);

    const db = await this.tenantPrisma.getClient(tenantSlug);
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Já existe um usuário com este e-mail.');
    }

    const role = await this.resolveRole(db, profile);
    const passwordHash = await bcrypt.hash(password, 10);

    const created = await db.user.create({
      data: {
        name,
        email,
        passwordHash,
        roles: { connect: { id: role.id } },
      },
      include: { roles: true },
    });
    return this.toSummary(created);
  }

  async update(
    tenantSlug: string,
    actorUserId: string,
    id: string,
    body: {
      name?: unknown;
      email?: unknown;
      profile?: unknown;
      password?: unknown;
      isActive?: unknown;
    },
  ): Promise<UserSummary> {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const target = await db.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!target) throw new NotFoundException('Usuário não encontrado.');

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = this.validateName(body.name);
    if (body.email !== undefined) {
      const email = this.validateEmail(body.email);
      if (email !== target.email) {
        const dup = await db.user.findUnique({ where: { email } });
        if (dup) throw new BadRequestException('Já existe um usuário com este e-mail.');
        data.email = email;
      }
    }
    if (body.password !== undefined) {
      const password = this.validatePassword(body.password);
      data.passwordHash = await bcrypt.hash(password, 10);
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        throw new BadRequestException('Campo isActive precisa ser booleano.');
      }
      if (!body.isActive && target.id === actorUserId) {
        throw new BadRequestException('Você não pode desativar a si mesmo.');
      }
      if (!body.isActive) {
        await this.ensureNotLastManager(db, target.id, target.roles);
      }
      data.isActive = body.isActive;
    }

    if (body.profile !== undefined) {
      const profile = this.validateProfile(body.profile);
      const currentProfile = this.toProfile(target.roles);
      if (profile !== currentProfile) {
        // Se rebaixando manager → cashier, valida último gerente
        if (currentProfile === 'manager' && profile === 'cashier') {
          await this.ensureNotLastManager(db, target.id, target.roles);
        }
        const role = await this.resolveRole(db, profile);
        // Substitui o conjunto de roles pelo único papel correspondente.
        // (mantém simples e evita conflitos com roles legadas como `admin`)
        data.roles = { set: [{ id: role.id }] };
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: data as never,
      include: { roles: true },
    });
    return this.toSummary(updated);
  }

  async remove(
    tenantSlug: string,
    actorUserId: string,
    id: string,
  ): Promise<UserSummary> {
    // Política: soft-delete (desativação) para preservar histórico (vendas, caixas).
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const target = await db.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!target) throw new NotFoundException('Usuário não encontrado.');
    if (target.id === actorUserId) {
      throw new ForbiddenException('Você não pode remover o próprio usuário.');
    }
    if (target.isActive) {
      await this.ensureNotLastManager(db, target.id, target.roles);
    }
    const updated = await db.user.update({
      where: { id },
      data: { isActive: false },
      include: { roles: true },
    });
    return this.toSummary(updated);
  }

  private async ensureNotLastManager(
    db: Awaited<ReturnType<TenantPrismaService['getClient']>>,
    targetUserId: string,
    targetRoles: { name: string }[],
  ): Promise<void> {
    const isManagerLike =
      targetRoles.some((r) => r.name === 'admin' || r.name === 'manager');
    if (!isManagerLike) return;

    const otherActiveManagers = await db.user.count({
      where: {
        id: { not: targetUserId },
        isActive: true,
        roles: { some: { name: { in: ['admin', 'manager'] } } },
      },
    });
    if (otherActiveManagers === 0) {
      throw new BadRequestException(
        'Operação bloqueada: este é o último gerente ativo do sistema. Cadastre outro gerente antes de continuar.',
      );
    }
  }

  async getPermissions(tenantSlug: string, userId: string) {
    const db = await this.tenantPrisma.getClient(tenantSlug);
    const u = await db.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado.');
    return this.permissions.listForUser(
      tenantSlug,
      userId,
      u.roles.map((r) => r.name),
    );
  }

  async updatePermissions(
    tenantSlug: string,
    userId: string,
    grants: PermissionGrantInput[],
  ) {
    const permissions = await this.permissions.updateForUser(tenantSlug, userId, grants);
    return { permissions };
  }
}
