import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9._-]{3,32}$/, {
    message: 'Usuário inválido: use 3 a 32 caracteres (letras, números, ponto, underscore ou hífen).',
  })
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  tenantSlug!: string;
}
