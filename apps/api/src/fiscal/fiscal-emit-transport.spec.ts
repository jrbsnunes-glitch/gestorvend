import { envFiscalEmitTransport, resolveFiscalEmitTransport } from './fiscal-emit-transport';

describe('resolveFiscalEmitTransport', () => {
  it('padrão do servidor é dry-run', () => {
    expect(envFiscalEmitTransport(undefined)).toBe('dry-run');
    expect(envFiscalEmitTransport('')).toBe('dry-run');
  });

  it('Produção sempre usa SOAP, mesmo com .env dry-run', () => {
    expect(
      resolveFiscalEmitTransport({ envTransport: 'dry-run', sefazEnvironment: 'PRODUCAO' }),
    ).toBe('soap');
  });

  it('Homologação respeita o .env', () => {
    expect(
      resolveFiscalEmitTransport({ envTransport: 'dry-run', sefazEnvironment: 'HOMOLOGACAO' }),
    ).toBe('dry-run');
    expect(
      resolveFiscalEmitTransport({ envTransport: 'soap', sefazEnvironment: 'HOMOLOGACAO' }),
    ).toBe('soap');
  });
});
