import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from './strategies/jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return req.user;
  },
);
