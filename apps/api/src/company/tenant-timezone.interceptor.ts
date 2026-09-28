import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithActiveTimezone } from '../common/tenant-timezone.context';
import { CompanyTimezoneService } from './company-timezone.service';

function tenantSlugFromRequest(req: {
  user?: { tenantSlug?: string };
  tenantSlug?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): string | undefined {
  if (req.user?.tenantSlug) return req.user.tenantSlug;
  if (req.tenantSlug) return req.tenantSlug;
  const q = req.query?.tenantSlug;
  if (typeof q === 'string' && q.trim()) return q.trim();
  const b = req.body?.tenantSlug;
  if (typeof b === 'string' && b.trim()) return b.trim();
  return undefined;
}

@Injectable()
export class TenantTimezoneInterceptor implements NestInterceptor {
  constructor(private readonly timezones: CompanyTimezoneService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest();
    const slug = tenantSlugFromRequest(req);
    if (!slug) return next.handle();

    const tz = await this.timezones.getTimezone(slug);
    return new Observable((observer) => {
      runWithActiveTimezone(tz, () => {
        next.handle().subscribe(observer);
      });
    });
  }
}
