"""
GestorVendChat — webhook de mensagens (Meta WhatsApp Cloud ou simulador).

POST /webhook/factory/message
  { "tenantSlug", "fromPhone", "text", "customerName?" }

Resposta: { "replies": ["...", ...] }
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from factory_fsm import FactoryBot
from gv_api import GestorVendClient

app = FastAPI(title="GestorVendChat", version="1.0.0")


class Settings(BaseSettings):
    gestorvend_api_url: str = Field(default="http://127.0.0.1:3000/api", alias="GESTORVEND_API_URL")
    wachat_api_key: str = Field(default="", alias="WACHAT_API_KEY")
    public_store_base_url: str = Field(default="http://127.0.0.1:5173", alias="PUBLIC_STORE_BASE_URL")
    webhook_secret: str = Field(default="", alias="WACHAT_WEBHOOK_SECRET")

    model_config = {"populate_by_name": True}


settings = Settings()
gv_client = GestorVendClient(settings.gestorvend_api_url, settings.wachat_api_key)
factory_bot = FactoryBot(gv_client, settings.public_store_base_url)


class InboundMessage(BaseModel):
    tenant_slug: str = Field(alias="tenantSlug")
    from_phone: str = Field(alias="fromPhone")
    text: str
    customer_name: str | None = Field(default=None, alias="customerName")


class OutboundReplies(BaseModel):
    replies: list[str]


def _check_webhook_secret(provided: str | None) -> None:
    expected = settings.webhook_secret.strip()
    if not expected:
        return
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Webhook secret inválido.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/webhook/factory/message", response_model=OutboundReplies)
async def factory_message(
    body: InboundMessage,
    x_wachat_webhook_secret: str | None = Header(default=None, alias="X-WaChat-Webhook-Secret"),
) -> OutboundReplies:
    _check_webhook_secret(x_wachat_webhook_secret)
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text vazio")
    replies = await factory_bot.handle(
        body.tenant_slug.strip(),
        body.from_phone,
        body.text,
        body.customer_name,
    )
    return OutboundReplies(replies=replies)


@app.post("/webhook/factory/simulate")
async def simulate_meta_payload(payload: dict[str, Any]) -> OutboundReplies:
    """
    Adaptador mínimo: extrai tenantSlug de env DEFAULT_TENANT_SLUG e primeira mensagem de texto.
    Integração Meta completa fica no deploy (verify token GET, parsing entry/changes).
    """
    tenant = os.environ.get("DEFAULT_TENANT_SLUG", "").strip()
    if not tenant:
        raise HTTPException(status_code=400, detail="DEFAULT_TENANT_SLUG não configurado")
    text = ""
    phone = ""
    name = ""
    try:
        entry = (payload.get("entry") or [])[0]
        change = (entry.get("changes") or [])[0]
        value = change.get("value") or {}
        contact = (value.get("contacts") or [{}])[0]
        name = (contact.get("profile") or {}).get("name") or ""
        msg = (value.get("messages") or [{}])[0]
        phone = msg.get("from") or ""
        text = (msg.get("text") or {}).get("body") or ""
    except (IndexError, KeyError, TypeError):
        raise HTTPException(status_code=400, detail="Payload Meta inválido")
    replies = await factory_bot.handle(tenant, phone, text, name or None)
    return OutboundReplies(replies=replies)
