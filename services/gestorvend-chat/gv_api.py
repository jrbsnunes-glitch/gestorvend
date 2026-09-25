"""Cliente HTTP da bridge GestorVend (`/wachat/factory/*`)."""

from __future__ import annotations

from typing import Any

import httpx


class GestorVendApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class GestorVendClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {"X-WaChat-Key": self.api_key, "Content-Type": "application/json"}

    async def factory_catalog(self, tenant_slug: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(
                f"{self.base_url}/wachat/factory/catalog",
                params={"tenantSlug": tenant_slug},
                headers=self._headers(),
            )
        if r.status_code >= 400:
            raise GestorVendApiError(r.text or r.reason_phrase, r.status_code)
        return r.json()

    async def factory_create_lead(self, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{self.base_url}/wachat/factory/leads",
                json=payload,
                headers=self._headers(),
            )
        if r.status_code >= 400:
            raise GestorVendApiError(r.text or r.reason_phrase, r.status_code)
        return r.json()
