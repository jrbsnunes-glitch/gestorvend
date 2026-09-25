"""
Máquina de estados — catálogo fabricado WhatsApp → lead na Fábrica → handoff humano.
Estado em memória (TTL); produção: Redis com mesma chave `tenant:phone`.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from gv_api import GestorVendApiError, GestorVendClient

State = Literal[
    "idle",
    "menu",
    "catalog_page",
    "await_qty",
    "await_notes",
    "confirm",
    "done",
]

PAGE_SIZE = 8
SESSION_TTL_SEC = 48 * 3600


@dataclass
class Session:
    tenant_slug: str
    phone: str
    state: State = "idle"
    updated_at: float = field(default_factory=time.time)
    catalog: list[dict[str, Any]] = field(default_factory=list)
    page: int = 0
    selected: dict[str, Any] | None = None
    quantity: str = "1"
    notes: str = ""
    external_ref: str = ""
    customer_name: str = ""

    def touch(self) -> None:
        self.updated_at = time.time()

    def expired(self) -> bool:
        return time.time() - self.updated_at > SESSION_TTL_SEC


_sessions: dict[str, Session] = {}


def _key(tenant_slug: str, phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"{tenant_slug}:{digits}"


def _norm(text: str) -> str:
    return (text or "").strip().lower()


def _parse_qty(raw: str) -> str | None:
    s = raw.strip().replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return None
    if n <= 0:
        return None
    return s


def _format_price(raw: str | None) -> str:
    if not raw:
        return "sob consulta"
    try:
        v = float(str(raw).replace(",", "."))
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except ValueError:
        return "sob consulta"


def _product_line(p: dict[str, Any]) -> str:
    idx = p.get("listIndex", "?")
    name = p.get("name", "")
    code = p.get("controlNumber", "")
    price = _format_price(p.get("retailPrice"))
    lead = p.get("leadTimeDays")
    lead_txt = f" · prazo {lead} dias" if lead else ""
    return f"{idx}. #{code} {name} — {price}{lead_txt}"


class FactoryBot:
    def __init__(self, gv: GestorVendClient, public_store_base_url: str):
        self.gv = gv
        self.store_base = public_store_base_url.rstrip("/")

    def _session(self, tenant_slug: str, phone: str) -> Session:
        k = _key(tenant_slug, phone)
        s = _sessions.get(k)
        if s and s.expired():
            del _sessions[k]
            s = None
        if not s:
            s = Session(tenant_slug=tenant_slug, phone=phone)
            _sessions[k] = s
        s.touch()
        return s

    async def handle(
        self,
        tenant_slug: str,
        phone: str,
        text: str,
        customer_name: str | None = None,
    ) -> list[str]:
        s = self._session(tenant_slug, phone)
        if customer_name and customer_name.strip():
            s.customer_name = customer_name.strip()

        msg = _norm(text)
        if msg in ("menu", "inicio", "início", "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite"):
            s.state = "menu"
            return [self._menu_text()]

        if s.state == "idle":
            s.state = "menu"
            return [self._welcome(), self._menu_text()]

        if s.state == "menu":
            return await self._handle_menu(s, msg)

        if s.state == "catalog_page":
            return await self._handle_catalog_page(s, msg)

        if s.state == "await_qty":
            return self._handle_qty(s, text.strip())

        if s.state == "await_notes":
            return self._handle_notes(s, text.strip())

        if s.state == "confirm":
            return await self._handle_confirm(s, msg)

        if s.state == "done":
            return [
                "Seu pedido de orçamento já foi registrado. "
                "Digite *menu* para iniciar outra consulta ou aguarde nosso consultor."
            ]

        s.state = "menu"
        return [self._menu_text()]

    def _welcome(self) -> str:
        return (
            "Olá! Sou o assistente de orçamentos da fábrica. "
            "Posso mostrar os modelos disponíveis e registrar seu pedido para um consultor formalizar a proposta."
        )

    def _menu_text(self) -> str:
        return (
            "Escolha uma opção:\n"
            "1 — Ver catálogo de produtos\n"
            "2 — Falar com atendente (encaminhamos seu contato)\n\n"
            "A qualquer momento, envie *menu* para voltar aqui."
        )

    async def _handle_menu(self, s: Session, msg: str) -> list[str]:
        if msg in ("1", "catalogo", "catálogo", "ver catalogo", "ver catálogo"):
            return await self._show_catalog_page(s, 0)
        if msg in ("2", "atendente", "humano"):
            s.state = "done"
            return [
                "Certo! Um consultor humano dará continuidade por aqui em breve. "
                "Se preferir, você também pode acessar nossa loja online."
            ]
        return ["Opção inválida.", self._menu_text()]

    async def _show_catalog_page(self, s: Session, page: int) -> list[str]:
        try:
            data = await self.gv.factory_catalog(s.tenant_slug)
        except GestorVendApiError:
            url = f"{self.store_base}/loja/{s.tenant_slug}"
            s.state = "menu"
            return [
                "Não consegui carregar o catálogo agora.",
                f"Tente pelo navegador: {url}",
                self._menu_text(),
            ]

        products = data.get("products") or []
        s.catalog = products
        s.page = page
        s.state = "catalog_page"

        if not products:
            s.state = "menu"
            return ["Nenhum produto disponível no catálogo no momento.", self._menu_text()]

        start = page * PAGE_SIZE
        chunk = products[start : start + PAGE_SIZE]
        lines = [_product_line(p) for p in chunk]
        nav = []
        if start + PAGE_SIZE < len(products):
            nav.append("Envie *mais* para ver a próxima página.")
        if page > 0:
            nav.append("Envie *voltar* para a página anterior.")
        footer = (
            "Responda com o *número da lista* ou com o *código* do produto (#) para escolher."
        )
        out = ["*Catálogo — produtos sob encomenda*", *lines, footer, *nav]
        return out

    async def _handle_catalog_page(self, s: Session, msg: str) -> list[str]:
        if msg == "mais":
            return await self._show_catalog_page(s, s.page + 1)
        if msg == "voltar":
            return await self._show_catalog_page(s, max(0, s.page - 1))

        chosen: dict[str, Any] | None = None
        if msg.isdigit():
            n = int(msg)
            for p in s.catalog:
                if p.get("listIndex") == n:
                    chosen = p
                    break
        else:
            m = re.search(r"#?\s*(\d+)", msg)
            if m:
                code = int(m.group(1))
                for p in s.catalog:
                    if p.get("controlNumber") == code:
                        chosen = p
                        break

        if not chosen:
            return ["Não encontrei esse item. Use o número da lista ou o código # do produto.", "Ou *menu* para recomeçar."]

        s.selected = chosen
        s.state = "await_qty"
        return [
            f"Você escolheu: *{chosen.get('name')}* (#{chosen.get('controlNumber')}).",
            "Qual a *quantidade* desejada? (ex.: 1 ou 2,5)",
        ]

    def _handle_qty(self, s: Session, raw: str) -> list[str]:
        q = _parse_qty(raw)
        if not q:
            return ["Quantidade inválida. Informe um número maior que zero."]
        s.quantity = q
        s.state = "await_notes"
        return [
            "Deseja acrescentar alguma observação? (medidas, cor, prazo…)",
            "Se não, responda *não* ou *-*. ",
        ]

    def _handle_notes(self, s: Session, raw: str) -> list[str]:
        low = _norm(raw)
        if low not in ("nao", "não", "-", "n", "ok", "nenhuma", "nenhum"):
            s.notes = raw.strip()
        else:
            s.notes = ""
        s.state = "confirm"
        p = s.selected or {}
        ref_suffix = re.sub(r"\D", "", s.phone)[-10:]
        s.external_ref = f"wa:{s.tenant_slug}:{ref_suffix}:{p.get('variantId', '')}:{s.quantity}"
        summary = (
            f"*Confirme seu pedido de orçamento:*\n"
            f"Produto: {p.get('name')} (#{p.get('controlNumber')})\n"
            f"Quantidade: {s.quantity}\n"
        )
        if s.notes:
            summary += f"Obs.: {s.notes}\n"
        summary += "\n1 — Confirmar\n2 — Cancelar e voltar ao menu"
        return [summary]

    async def _handle_confirm(self, s: Session, msg: str) -> list[str]:
        if msg in ("2", "cancelar", "voltar"):
            s.state = "menu"
            s.selected = None
            return ["Pedido cancelado.", self._menu_text()]
        if msg not in ("1", "sim", "confirmar", "ok"):
            return ["Responda *1* para confirmar ou *2* para cancelar."]

        p = s.selected
        if not p or not p.get("variantId"):
            s.state = "menu"
            return ["Sessão expirada. Escolha o produto novamente.", self._menu_text()]

        payload = {
            "tenantSlug": s.tenant_slug,
            "customerPhone": s.phone,
            "customerName": s.customer_name or None,
            "finishedVariantId": p["variantId"],
            "quantity": s.quantity,
            "notes": s.notes or None,
            "externalRef": s.external_ref,
        }
        try:
            result = await self.gv.factory_create_lead(payload)
        except GestorVendApiError:
            s.state = "menu"
            return [
                "Não foi possível registrar seu pedido agora. Tente novamente em instantes ou digite *menu*.",
            ]

        num = result.get("number")
        s.state = "done"
        return [
            f"Recebemos seu pedido de orçamento (ref. *#{num}*). "
            "Um consultor vai formalizar a proposta em breve por este WhatsApp. Obrigado!"
        ]
