import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Corpo PATCH para baixa de conta a pagar ou recebimento de conta a receber.
 * Classe explícita para o ValidationPipe global (whitelist) não descartar campos.
 */
export class SettleBillBodyDto {
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
  cashSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  /** Conta do plano referencial (centro de custo / receita). */
  @IsOptional()
  @IsString()
  referentialAccountId?: string | null;
}
