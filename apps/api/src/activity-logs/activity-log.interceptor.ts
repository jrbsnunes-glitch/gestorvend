import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { ActivityLogAction } from '../generated/tenant-client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import {
  buildCrudSummary,
  crudActionFromMethod,
  detectReportGet,
  parseApiPath,
  pickEntityRef,
  shouldSkipMutationLog,
} from './activity-log.helpers';
import { ActivityLogService } from './activity-log.service';

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly activityLog: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user?.sub || !user.tenantSlug) {
      return next.handle();
    }

    const method = req.method.toUpperCase();
    const { segments, subPath } = parseApiPath(req.url);

    if (method === 'GET') {
      const report = detectReportGet(segments, req.url);
      if (report) {
        return next.handle().pipe(
          tap(() => {
            this.activityLog.record({
              tenantSlug: user.tenantSlug,
              userId: user.sub,
              action: ActivityLogAction.REPORT,
              summary: report.summary,
              entityType: 'report',
              entityRef: report.entityRef,
            });
          }),
        );
      }
    }

    const crudAction = crudActionFromMethod(method);
    if (!crudAction || shouldSkipMutationLog(segments, method)) {
      return next.handle();
    }

    const resource = segments.slice(0, 2).join('/') || segments[0] || 'registro';

    return next.handle().pipe(
      tap((body) => {
        const entityRef = pickEntityRef(body);
        this.activityLog.record({
          tenantSlug: user.tenantSlug,
          userId: user.sub,
          action: crudAction,
          summary: buildCrudSummary({
            action: crudAction,
            resource,
            subPath,
            entityRef,
          }),
          entityType: resource,
          entityRef,
        });
      }),
    );
  }
}
