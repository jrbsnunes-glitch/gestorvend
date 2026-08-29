# Credenciamento Getnet + Mercado Pago (GestorVend)

Guia operacional para obter credenciais sandbox/produção antes de configurar em **Configurações → Pagamentos** (`/pagamentos`).

## Getnet (adquirente Grupo Santander)

1. **Contrato / parceria**
   - Software House: [site.getnet.com.br/parcerias/ecommerce](https://site.getnet.com.br/parcerias/ecommerce/)
   - Suporte: **4002-4000**
2. **Documentação técnica**
   - Swagger Brasil: [developers.getnet.com.br](https://developers.getnet.com.br/products-docs/rv4tz0jamap7lsor1myfb6zs/swagger)
   - Autenticação: [docs.globalgetnet.com/pt/products/onboarding/authentication](https://docs.globalgetnet.com/pt/products/onboarding/authentication)
3. **Credenciais entregues após credenciamento**
   - `client_id`, `client_secret`, `channel`, `scope`
   - Ambiente homologação: `https://api-homologacao.getnet.com.br`
4. **Webhook**
   - URL gerada no GestorVend: `https://{seu-dominio}/api/webhooks/psp/getnet?tenant={slug}`
   - Configure usuário/senha no painel Getnet se exigido pelo contrato

## Mercado Pago

1. **Conta vendedor** em [mercadopago.com.br](https://www.mercadopago.com.br)
2. **Criar aplicação** em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app)
   - Tipo: **Pagamentos online** → **Checkout Transparente** → **Orders API**
3. **Chave PIX** cadastrada na conta (obrigatório para receber PIX)
4. **Credenciais de teste** (painel → Dados da integração → Testes)
   - **Public Key** — frontend (Card Payment Brick)
   - **Access Token** — backend (nunca expor no navegador)
5. **Webhook**
   - Painel → Webhooks → evento **Order (Mercado Pago)**
   - URL: `https://{seu-dominio}/api/webhooks/psp/mercadopago?tenant={slug}`
   - Copie o **secret** de assinatura para o campo correspondente no GestorVend

## Variáveis de ambiente (servidor)

```env
# Criptografia das credenciais PSP por tenant (32+ caracteres recomendado)
PAYMENT_CREDENTIALS_KEY=sua-chave-secreta-longa

# URL pública da API (para exibir links de webhook na tela de configuração)
PUBLIC_API_BASE_URL=https://seu-dominio.com/api
```

Em desenvolvimento local, use túnel (ngrok/cloudflare) para testar webhooks.

## Homologação antes de produção

- [ ] PIX sandbox: QR gerado no PDV e pagamento simulado
- [ ] Cartão MP: cartões de teste do painel MP
- [ ] Webhook recebido e venda finalizada automaticamente
- [ ] Credenciais de produção ativadas no painel de cada PSP
