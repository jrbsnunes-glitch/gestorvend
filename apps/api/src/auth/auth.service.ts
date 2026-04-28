import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
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
  ) {}

  async login(dto: LoginDto) {
    await this.tenantService.assertLicenseActive(dto.tenantSlug);

    const prisma = await this.tenantPrisma.getClient(dto.tenantSlug);
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
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
      user: { id: user.id, email: user.email, name: user.name, roles },
    };
  }
}
