/**
 * Fuso padrão do processo Node (workers/cron sem tenant). Requisições HTTP usam
 * Company.timezone (UF → IANA) via TenantTimezoneInterceptor.
 * APP_TIMEZONE continua como fallback global (ex.: America/Cuiaba).
 *
 * Importado em primeiro lugar em main.ts, antes de qualquer Date.
 */
process.env.TZ = process.env.APP_TIMEZONE?.trim() || 'America/Sao_Paulo';
