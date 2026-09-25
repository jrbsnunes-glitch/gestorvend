import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { LicenseStatus, PlanCode, TenantModuleAddon } from '../../generated/central-client';
import { PORTAL_MODULE_ADDON_CODES } from '../../common/tenant-module-addons.util';

/**
 * Corpo PATCH /portal/clients/:cnpj/license — classe explícita para o ValidationPipe
 * global (whitelist) não descartar campos como enabledAddons.
 */
export class UpdatePortalLicenseBodyDto {
  @IsOptional()
  @IsEnum(PlanCode)
  planCode?: PlanCode;

  @IsOptional()
  @IsEnum(LicenseStatus)
  licenseStatus?: LicenseStatus;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  licenseValidFrom?: string | null;

  @IsOptional()
  licenseExpiresAt?: string | null;

  @IsOptional()
  monthlyFee?: number | string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  renewDays?: number;

  @IsOptional()
  @IsArray()
  @IsIn(PORTAL_MODULE_ADDON_CODES, { each: true })
  enabledAddons?: TenantModuleAddon[];
}

/** PATCH /portal/clients/:cnpj/modules — só addons (evita perda de campo no PATCH da licença). */
export class UpdatePortalModulesBodyDto {
  @IsArray()
  @IsIn(PORTAL_MODULE_ADDON_CODES, { each: true })
  modules!: TenantModuleAddon[];
}

/** POST /portal/clients — enabledAddons e demais campos do cadastro inicial. */
export class CreatePortalClientBodyDto {
  @IsString()
  cnpj!: string;

  @IsString()
  companyName!: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  databaseName?: string;

  @IsOptional()
  @IsEnum(PlanCode)
  planCode?: PlanCode;

  @IsOptional()
  @IsEnum(LicenseStatus)
  licenseStatus?: LicenseStatus;

  @IsOptional()
  licenseValidFrom?: string | null;

  @IsOptional()
  licenseExpiresAt?: string | null;

  @IsOptional()
  @IsString()
  firstAdminEmail?: string;

  @IsOptional()
  @IsString()
  firstAdminUsername?: string;

  @IsOptional()
  @IsString()
  firstAdminPassword?: string;

  @IsOptional()
  monthlyFee?: number | string | null;

  @IsOptional()
  @IsArray()
  @IsIn(PORTAL_MODULE_ADDON_CODES, { each: true })
  enabledAddons?: TenantModuleAddon[];
}
