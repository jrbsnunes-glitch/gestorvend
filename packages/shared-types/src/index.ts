export type LicenseStatus = 'trial' | 'active' | 'suspended' | 'expired';

export interface TenantPublic {
  id: string;
  slug: string;
  companyName: string;
  cnpj: string;
  licenseStatus: LicenseStatus;
}
