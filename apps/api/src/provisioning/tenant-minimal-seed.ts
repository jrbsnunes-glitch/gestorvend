import * as bcrypt from 'bcrypt';
import { Prisma, PrismaClient } from '../generated/tenant-client';

export type TenantMinimalSeedOptions = {
  adminEmail: string;
  adminPassword: string;
  adminDisplayName?: string;
};

/**
 * Papéis, usuário admin, local padrão e config fiscal placeholder — idempotente (upserts).
 */
export async function seedTenantMinimal(
  tenantUrl: string,
  opts: TenantMinimalSeedOptions,
): Promise<void> {
  const tenant = new PrismaClient({ datasources: { db: { url: tenantUrl } } });
  try {
    const roles = ['admin', 'manager', 'seller', 'finance'] as const;
    for (const name of roles) {
      await tenant.role.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    }

    const adminRole = await tenant.role.findUniqueOrThrow({ where: { name: 'admin' } });
    const hash = await bcrypt.hash(opts.adminPassword, 10);
    const email = opts.adminEmail.trim().toLowerCase();
    await tenant.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: hash,
        name: opts.adminDisplayName?.trim() || 'Administrador',
        roles: { connect: { id: adminRole.id } },
      },
      update: {
        passwordHash: hash,
        name: opts.adminDisplayName?.trim() || 'Administrador',
        roles: { set: [{ id: adminRole.id }] },
      },
    });

    await tenant.stockLocation.upsert({
      where: { code: 'MATRIZ' },
      create: { code: 'MATRIZ', name: 'Matriz', isDefault: true },
      update: { isDefault: true },
    });

    const fc = await tenant.fiscalConfig.findFirst();
    if (!fc) {
      await tenant.fiscalConfig.create({
        data: { regime: 'SIMPLES', notes: 'Placeholder Etapa 2' },
      });
    }

    await tenant.fiscalSituation.upsert({
      where: { code: 'RT2026-TRIB-TEST' },
      create: {
        code: 'RT2026-TRIB-TEST',
        name: 'Operação padrão — destaque CBS / IBS (fase teste 2026, referência normativa)',
        description:
          'Situação genérica para treino de sistemas na transição tributária. Ajuste NCM/CEST no cadastro do produto; revise CST conforme cada item após a fiscal.',
        fiscalOrigin: '0',
        cstIcms: '00',
        cfopInternal: '5102',
        cfopInterstate: '6102',
        cstPis: '01',
        cstCofins: '01',
        ibsTestRate: new Prisma.Decimal('0.1'),
        cbsTestRate: new Prisma.Decimal('0.9'),
        regulationNotes:
          'Base legal: LC 214/2025; regulamentos da CBS (Receita Federal) e do IBS (CGIBS), com disciplina comum em 2026. Diretrizes de destaque nos documentos fiscais eletrônicos na transição: Ato conjunto RFB/CGIBS nº 1/2025 (consulte a redação atual na imprensa oficial). Orientação público 2026: uso de frações-percentuais de teste apenas para adequação dos sistemas; confirme alíquota e calendários em https://www.gov.br/fazenda/ e atualizações do Comitê Gestor do IBS.',
        isActive: true,
      },
      update: {
        ibsTestRate: new Prisma.Decimal('0.1'),
        cbsTestRate: new Prisma.Decimal('0.9'),
        regulationNotes:
          'Base legal: LC 214/2025; regulamentos CBS e IBS. Ato conjunto RFB/CGIBS nº 1/2025 (redação atual na imprensa oficial). Referências institucionais: https://www.gov.br/fazenda/ e comunicados do CGIBS.',
      },
    });

    await tenant.fiscalSituation.upsert({
      where: { code: 'SIMPLES-PLACEHOLDER' },
      create: {
        code: 'SIMPLES-PLACEHOLDER',
        name: 'Simples Nacional — placeholder (CSOSN)',
        description: 'Use CSOSN adequado ao enquadramento; revisar com contador.',
        csosn: '102',
        fiscalOrigin: '0',
        cfopInternal: '5102',
        cfopInterstate: '6102',
        ibsTestRate: new Prisma.Decimal('0.1'),
        cbsTestRate: new Prisma.Decimal('0.9'),
        regulationNotes:
          'Simples Nacional: regras específicas de escrituração; destaque CBS/IBS na transição segue cronograma da legislação e do órgão de registro do MEI/simples quando aplicável.',
        isActive: true,
      },
      update: {},
    });

    await tenant.fiscalSituation.upsert({
      where: { code: 'ISENTO-PLACEHOLDER' },
      create: {
        code: 'ISENTO-PLACEHOLDER',
        name: 'Isento / não incidência — placeholder',
        description: 'Ajustar CST e CFOP conforme natureza real da operação.',
        fiscalOrigin: '0',
        cstIcms: '40',
        cstPis: '06',
        cstCofins: '06',
        cfopInternal: '5102',
        cfopInterstate: '6102',
        ibsTestRate: new Prisma.Decimal('0'),
        cbsTestRate: new Prisma.Decimal('0'),
        regulationNotes:
          'Classificações tributárias exigem análise do fato gerador atual (ICMS/PIS/Cofins/ISS) até migração plena CBS/IBS; campos são modelo para cadastro mestre até integração NF-e.',
        isActive: true,
      },
      update: {},
    });
  } finally {
    await tenant.$disconnect();
  }
}
