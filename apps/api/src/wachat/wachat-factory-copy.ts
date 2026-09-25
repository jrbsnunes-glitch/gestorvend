/** Textos padrão do bot Fábrica quando Empresa não define templates customizados. */

export const DEFAULT_FACTORY_WA_WELCOME =
  'Olá! Sou o assistente de orçamentos da fábrica. ' +
  'Posso mostrar os modelos disponíveis e registrar seu pedido para um consultor formalizar a proposta.';

export const DEFAULT_FACTORY_WA_MENU =
  'Escolha uma opção:\n' +
  '1 — Ver catálogo de produtos\n' +
  '2 — Falar com atendente (encaminhamos seu contato)\n\n' +
  'A qualquer momento, envie *menu* para voltar aqui.';

export const DEFAULT_FACTORY_WA_HANDOFF =
  'Recebemos seu pedido de orçamento (ref. *#{numero}*). ' +
  'Um consultor vai formalizar a proposta em breve por este WhatsApp. Obrigado!';

export const DEFAULT_CATALOG_WHATSAPP_MESSAGE =
  'Olá! Gostaria de um orçamento para o produto #{codigo} — {nome}.';

export type TemplateVars = Record<string, string | number | undefined | null>;

/** Substitui `{chave}` no template (ex.: `{codigo}`, `{nome}`, `{numero}`). */
export function applyMessageTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}
