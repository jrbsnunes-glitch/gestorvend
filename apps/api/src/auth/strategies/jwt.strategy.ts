import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TenantService } from '../../tenant/tenant.service';

export type JwtPayload = {
  sub: string;
  email: string;
  tenantSlug: string;
  roles: string[];
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly tenantService: TenantService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload?.tenantSlug) {
      throw new UnauthorizedException();
    }
    await this.tenantService.assertLicenseActive(payload.tenantSlug);
    return {
      ...payload,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
    };
  }
}
