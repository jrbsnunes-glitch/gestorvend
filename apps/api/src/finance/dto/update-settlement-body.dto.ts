import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Corpo PATCH para editar um pagamento/recebimento já registrado. */
export class UpdateSettlementBodyDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  referentialAccountId?: string | null;

  /** Data/hora do pagamento ou recebimento (ISO). */
  @IsOptional()
  @IsString()
  settledAt?: string;
}
