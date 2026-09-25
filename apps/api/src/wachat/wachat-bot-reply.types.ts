/** Resposta do bot Fábrica — texto ou imagem (URL pública absoluta para Meta). */
export type WaChatBotReply =
  | { type: 'text'; body: string }
  | { type: 'image'; url: string; caption?: string };
