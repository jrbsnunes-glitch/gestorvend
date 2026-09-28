import { timezoneFromBrazilUf } from './br-uf-timezone.util';

describe('timezoneFromBrazilUf', () => {
  it('mapeia UFs com fuso distinto', () => {
    expect(timezoneFromBrazilUf('AM')).toBe('America/Manaus');
    expect(timezoneFromBrazilUf('AC')).toBe('America/Rio_Branco');
  });

  it('usa São Paulo para demais UFs', () => {
    expect(timezoneFromBrazilUf('SP')).toBe('America/Sao_Paulo');
    expect(timezoneFromBrazilUf('pr')).toBe('America/Sao_Paulo');
  });
});
