const LOOKUP_UA = 'GestorVend/1.0';

type ViaCepResponse = {
  erro?: boolean;
  ibge?: string;
};

export async function lookupIbgeByCep(cep: string): Promise<string | null> {
  const digits = cep.replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { 'User-Agent': LOOKUP_UA },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ViaCepResponse;
    if (data.erro || !data.ibge) return null;
    return String(data.ibge).replace(/\D/g, '').padStart(7, '0').slice(-7);
  } catch {
    return null;
  }
}
