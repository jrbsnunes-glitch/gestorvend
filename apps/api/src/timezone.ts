/**
 * Fuso do processo = fuso da loja. Todo cálculo de “dia” (dashboard, caixa,
 * relatórios) usa hora local. Servidor novo costuma subir em UTC — a venda
 * do fim da noite caía no dia seguinte. Ajuste com APP_TIMEZONE (ex.: America/Cuiaba).
 *
 * Importado em primeiro lugar em main.ts, antes de qualquer Date.
 */
process.env.TZ = process.env.APP_TIMEZONE?.trim() || 'America/Sao_Paulo';
