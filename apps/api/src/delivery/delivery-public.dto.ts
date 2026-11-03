import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DeliveryOrderItemDto {
  @IsString()
  @MinLength(1)
  variantId!: string;

  @IsOptional()
  quantity?: number | string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  notes?: string | null;
}

export class CreateDeliveryOrderDto {
  @IsIn(['DELIVERY', 'PICKUP'])
  fulfillment!: 'DELIVERY' | 'PICKUP';

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  notes?: string | null;

  @IsIn(['PICKUP', 'PIX_DELIVERER', 'PIX_ONLINE'])
  paymentMode!: 'PICKUP' | 'PIX_DELIVERER' | 'PIX_ONLINE';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryOrderItemDto)
  items!: DeliveryOrderItemDto[];
}
