import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CentralPrismaService } from '../prisma/central-prisma.service';

/**
 * Login do portal. Totalmente separado do `/auth/login` do tenant — o
 * SuperAdmin não tem vínculo com nenhum CNPJ específico.
 */
@Controller('portal/auth')
export class PortalAuthController {
  constructor(
    private readonly central: CentralPrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  async login(@Body() body: { email?: string; password?: string }) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!email || !password) {
      throw new BadRequestException('Informe email e senha.');
    }
    const admin = await this.central.superAdmin.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }
    const secret = this.config.get<string>('PORTAL_JWT_SECRET') ?? this.config.get<string>('JWT_ACCESS_SECRET');
    const token = this.jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        kind: 'superadmin',
      },
      { secret, expiresIn: this.config.get<string>('PORTAL_JWT_EXPIRES') ?? '8h' },
    );
    return {
      token,
      user: { id: admin.id, email: admin.email, name: admin.name },
    };
  }
}
