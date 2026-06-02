/** Mensagem amigável ao abrir .pfx/.p12 */
export function formatPfxLoadError(err: unknown, certPath: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('enoent') || lower.includes('no such file')) {
    return (
      `Arquivo do certificado não encontrado no servidor: "${certPath}". ` +
      'Copie o .pfx para a VPS e informe o caminho absoluto em Empresa → Emissor fiscal.'
    );
  }

  if (
    lower.includes('pkcs#12') ||
    lower.includes('unsupported pkcs12') ||
    lower.includes('mac could not be verified') ||
    lower.includes('mac verify failure') ||
    lower.includes('bad decrypt') ||
    lower.includes('invalid password')
  ) {
    return (
      'Senha do certificado digital incorreta ou arquivo .pfx inválido. ' +
      'Verifique o caminho e a senha em Empresa → Emissor fiscal. ' +
      'Se o arquivo foi exportado há muito tempo, gere um novo .pfx na Autoridade Certificadora.'
    );
  }

  if (lower.includes('não contém certificado') || lower.includes('não contém chave')) {
    return raw;
  }

  return `Não foi possível ler o certificado A1 (${certPath}): ${raw}`;
}
