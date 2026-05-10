"""HTTP REST views for the ETM panel.

Three endpoints replace the WebSocket approach used by the old panel:
  GET  /api/etm/sources            → list of configured watchers
  GET  /api/etm/entries[?filters]  → flat list of title entries
  POST /api/etm/update             → set enum value for one entry

All endpoints require an admin user.
"""
from __future__ import annotations

from http import HTTPStatus
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import CONF_WATCHER_TYPE, DOMAIN, MAX_ENUM, MIN_ENUM


class EtmSourcesView(HomeAssistantView):
    """GET /api/etm/sources — list all watcher config entries."""

    url = "/api/etm/sources"
    name = "api:etm:sources"

    async def get(self, request: web.Request) -> web.Response:
        """Return watcher list."""
        if not request["hass_user"].is_admin:
            return self.json_message("Admin access required", HTTPStatus.FORBIDDEN)
        hass: HomeAssistant = request.app["hass"]
        return self.json([
            {
                "entry_id": eid,
                "name": rt.name,
                "watcher_type": rt.entry.data[CONF_WATCHER_TYPE],
            }
            for eid, rt in hass.data.get(DOMAIN, {}).items()
        ])


class EtmEntriesView(HomeAssistantView):
    """GET /api/etm/entries — flat entry list with optional query filters.

    Query params:
      source       – filter by watcher entry_id
      unclassified – "1" or "true" to show only enum == 0
      search       – substring match (case-insensitive)
    """

    url = "/api/etm/entries"
    name = "api:etm:entries"

    async def get(self, request: web.Request) -> web.Response:
        """Return filtered entry list."""
        if not request["hass_user"].is_admin:
            return self.json_message("Admin access required", HTTPStatus.FORBIDDEN)
        hass: HomeAssistant = request.app["hass"]

        source_filter = request.query.get("source", "")
        unclassified_only = request.query.get("unclassified", "") in ("1", "true")
        search = request.query.get("search", "").lower().strip()

        result: list[dict[str, Any]] = []
        for entry_id, runtime in hass.data.get(DOMAIN, {}).items():
            if source_filter and entry_id != source_filter:
                continue
            for entry in runtime.store.entries.values():
                if unclassified_only and entry.enum != 0:
                    continue
                if search and search not in entry.key.lower():
                    continue
                result.append({
                    "entry_id": entry_id,
                    "source_name": runtime.name,
                    "watcher_type": runtime.entry.data[CONF_WATCHER_TYPE],
                    "key": entry.key,
                    "enum": entry.enum,
                    "first_seen": entry.first_seen,
                    "last_seen": entry.last_seen,
                    "seen_count": entry.seen_count,
                    "is_current": entry.key == runtime.current_key,
                })
        return self.json(result)


class EtmUpdateView(HomeAssistantView):
    """POST /api/etm/update {entry_id, key, enum_value} — update one mapping."""

    url = "/api/etm/update"
    name = "api:etm:update"

    async def post(self, request: web.Request) -> web.Response:
        """Persist a new enum value and push sensor state update."""
        if not request["hass_user"].is_admin:
            return self.json_message("Admin access required", HTTPStatus.FORBIDDEN)
        hass: HomeAssistant = request.app["hass"]

        try:
            data = await request.json()
        except Exception:
            return self.json_message("Invalid JSON body", HTTPStatus.BAD_REQUEST)

        entry_id = str(data.get("entry_id", "")).strip()
        key = str(data.get("key", "")).strip()
        raw_enum = data.get("enum_value")

        if not entry_id or not key or raw_enum is None:
            return self.json_message(
                "entry_id, key and enum_value are required", HTTPStatus.BAD_REQUEST
            )
        try:
            enum_value = int(raw_enum)
        except (TypeError, ValueError):
            return self.json_message("enum_value must be an integer", HTTPStatus.BAD_REQUEST)

        if not (MIN_ENUM <= enum_value <= MAX_ENUM):
            return self.json_message(
                f"enum_value must be {MIN_ENUM}–{MAX_ENUM}", HTTPStatus.BAD_REQUEST
            )

        runtime = hass.data.get(DOMAIN, {}).get(entry_id)
        if runtime is None:
            return self.json_message(f"Unknown entry_id: {entry_id}", HTTPStatus.NOT_FOUND)

        await runtime.store.async_set_enum(key, enum_value)
        runtime.refresh_current_enum()
        runtime._notify_listeners()

        return self.json({"success": True})
