# GestorVendChat (legado)

**Este serviço FastAPI não é mais necessário.**

O bot de orçamento da Fábrica e o webhook WhatsApp foram integrados à **API NestJS** do GestorVend:

- FSM: `apps/api/src/wachat/wachat-factory-bot.service.ts`
- Webhook Meta: `GET/POST /api/webhooks/whatsapp/factory`
- Documentação: [`docs/WACHAT-FACTORY.md`](../../docs/WACHAT-FACTORY.md)

A pasta `services/gestorvend-chat` permanece apenas como referência histórica e pode ser removida do deploy.
