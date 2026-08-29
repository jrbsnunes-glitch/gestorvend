import { Body, Controller, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';

/**
 * Webhooks públicos dos PSPs — sem JWT; validação por assinatura/credenciais.
 * URL: POST /api/webhooks/psp/:provider?tenant={slug}
 */
@Controller('webhooks/psp')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':provider')
  async receive(
    @Param('provider') provider: string,
    @Query('tenant') tenant: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!tenant?.trim()) {
      res.status(400).send('tenant query required');
      return;
    }
    try {
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) {
        if (typeof v === 'string') query[k] = v;
      }
      await this.payments.handleWebhook(tenant.trim(), provider, headers, body, query);
      res.status(200).send('ok');
    } catch {
      res.status(401).send('invalid');
    }
  }
}
