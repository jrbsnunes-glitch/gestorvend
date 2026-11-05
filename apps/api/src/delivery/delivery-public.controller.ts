import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryOrderDto } from './delivery-public.dto';

@Controller('public/delivery/:slug')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 40, ttl: 60_000 } })
export class DeliveryPublicController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  store(@Param('slug') slug: string) {
    return this.delivery.publicStore(slug);
  }

  @Get('menu')
  menu(@Param('slug') slug: string) {
    return this.delivery.publicMenu(slug);
  }

  @Post('orders')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  createOrder(
    @Param('slug') slug: string,
    @Body() body: CreateDeliveryOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.delivery.createPublicOrder(slug, body, idempotencyKey);
  }

  @Get('orders/latest')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  latestOrder(@Param('slug') slug: string, @Query('phone') phone?: string) {
    return this.delivery.getLatestOrderForPhone(slug, phone ?? '');
  }

  @Get('orders/:token')
  getOrder(@Param('slug') slug: string, @Param('token') token: string) {
    return this.delivery.getPublicOrder(slug, token);
  }

  @Post('orders/:token/pix')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  createPix(@Param('slug') slug: string, @Param('token') token: string) {
    return this.delivery.createPublicPix(slug, token);
  }

  @Get('orders/:token/pix')
  getPix(@Param('slug') slug: string, @Param('token') token: string) {
    return this.delivery.getPublicPix(slug, token);
  }

  @Post('orders/:token/pix/confirm')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  confirmPix(@Param('slug') slug: string, @Param('token') token: string) {
    return this.delivery.confirmPublicPix(slug, token);
  }
}
