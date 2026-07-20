import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { ActivityLogAction } from '../generated/tenant-client';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { TenantService } from '../tenant/tenant.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tenantService: TenantService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async login(dto: LoginDto) {
    await this.tenantService.assertLicenseActive(dto.tenantSlug);

    const username = dto.username.trim().toLowerCase();
    const prisma = await this.tenantPrisma.getClient(dto.tenantSlug);
    const user = await prisma.user.findUnique({
      where: { username },
      include: { roles: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const roles = user.roles.map((r) => r.name);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantSlug: dto.tenantSlug,
      roles,
    };

    const accessToken = this.jwt.sign(payload);

    this.activityLog.record({
      tenantSlug: dto.tenantSlug,
      userId: user.id,
      action: ActivityLogAction.LOGIN,
      summary: 'Acessou o sistema',
      entityType: 'auth',
    });

    const refreshToken = this.jwt.sign(
      { sub: user.id, tenantSlug: dto.tenantSlug, type: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES') ?? '7d',
      },
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        roles,
      },
    };
  }

  /** Emite novo access token a partir do refresh JWT (sessão longa, sem relogar). */
  async refreshAccess(refreshToken: string) {
    const secret = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Servidor sem JWT_REFRESH_SECRET');
    }

    let decoded: { sub?: string; tenantSlug?: string; type?: string };
    try {
      decoded = this.jwt.verify(refreshToken, { secret }) as typeof decoded;
    } catch {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    if (decoded.type !== 'refresh' || !decoded.sub || !decoded.tenantSlug) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    await this.tenantService.assertLicenseActive(decoded.tenantSlug);

    const prisma = await this.tenantPrisma.getClient(decoded.tenantSlug);
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { roles: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário inválido.');
    }

    const roles = user.roles.map((r) => r.name);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantSlug: decoded.tenantSlug,
      roles,
    };

    return { accessToken: this.jwt.sign(payload) };
  }
}
