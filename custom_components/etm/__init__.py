"""Entity Title Mapper integration."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import async_register_built_in_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME, EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, ServiceCall, State, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_state_change_event

from .const import (
    ATTR_DELETED,
    ATTR_ENTRIES,
    ATTR_ENTRY_ID,
    ATTR_KEY,
    CONF_ARTIST_ATTRIBUTE,
    CONF_RETENTION_DAYS,
    CONF_SOURCE_ENTITY,
    CONF_WATCHER_TYPE,
    DEFAULT_ARTIST_ATTRIBUTE,
    DOMAIN,
    MAX_ENUM,
    MIN_ENUM,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL,
    PLATFORMS,
    SERVICE_CLEAR_OLD,
    SERVICE_DELETE_ENTRY,
    SERVICE_IMPORT_ENTRIES,
    SERVICE_SET_ENUM,
)
from .storage import MapperStore


SET_ENUM_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_KEY): cv.string,
        vol.Required("enum"): vol.All(vol.Coerce(int), vol.Range(min=MIN_ENUM, max=MAX_ENUM)),
    }
)
DELETE_ENTRY_SCHEMA = vol.Schema(
    {vol.Required(ATTR_ENTRY_ID): cv.string, vol.Required(ATTR_KEY): cv.string}
)
CLEAR_OLD_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTRY_ID): cv.string,
        vol.Optional("days", default=30): vol.All(vol.Coerce(int), vol.Range(min=1)),
    }
)
IMPORT_ENTRY_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_KEY): cv.string,
        vol.Required("enum"): vol.All(vol.Coerce(int), vol.Range(min=MIN_ENUM, max=MAX_ENUM)),
    }
)
IMPORT_ENTRIES_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_ENTRY_ID): cv.string,
        vol.Required(ATTR_ENTRIES): vol.All(cv.ensure_list, [IMPORT_ENTRY_SCHEMA]),
    }
)

TITLE_ATTRIBUTE_CANDIDATES = {
    "game": (
        "media_title",
        "title",
        "game_title",
        "game_name",
        "app_title",
        "app_name",
        "activity",
        "activity_name",
    ),
    "media": ("media_title", "title", "media_content_id", "friendly_name"),
    "activity": ("activity", "activity_name", "media_title", "title", "app_name"),
}
IGNORED_RAW_VALUES = {
    "",
    "unknown",
    "unavailable",
    "none",
    "off",
    "idle",
    "standby",
}


class WatcherRuntime:
    """Runtime state for one watcher config entry."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialise runtime state."""
        self.hass = hass
        self.entry = entry
        self.store = MapperStore(hass, entry.entry_id)
        self.current_key: str | None = None
        self.current_enum = 0
        self._remove_listener = None
        self._listeners: list[Callable[[], None]] = []

    @property
    def name(self) -> str:
        """Return the watcher name."""
        return self.entry.data[CONF_NAME]

    @property
    def source_entity(self) -> str:
        """Return the watched source entity."""
        return self.entry.data[CONF_SOURCE_ENTITY]

    def add_listener(self, update_callback) -> None:
        """Register an entity update listener."""
        self._listeners.append(update_callback)

    def remove_listener(self, update_callback) -> None:
        """Remove an entity update listener."""
        if update_callback in self._listeners:
            self._listeners.remove(update_callback)

    async def async_setup(self) -> None:
        """Load storage and start watching state changes."""
        await self.store.async_load()
        self._remove_listener = async_track_state_change_event(
            self.hass, [self.source_entity], self._async_source_changed
        )
        state = self.hass.states.get(self.source_entity)
        if state is not None:
            await self.async_process_state(state)

    async def async_unload(self) -> None:
        """Stop watching state changes."""
        if self._remove_listener is not None:
            self._remove_listener()
            self._remove_listener = None
        self._listeners.clear()

    @callback
    def _notify_listeners(self) -> None:
        """Tell sensor entities to refresh."""
        for update_callback in list(self._listeners):
            update_callback()

    def refresh_current_enum(self) -> None:
        """Refresh the output enum from the current title mapping."""
        self.current_enum = self.store.get_enum(self.current_key)

    def catalog_summary(self) -> dict[str, Any]:
        """Return title catalog data for entity attributes and the panel."""
        entries = self.store.sorted_entries()
        return {
            "entry_count": len(entries),
            "known_titles": [entry.key for entry in entries],
            "mapped_titles": {entry.key: entry.enum for entry in entries if entry.enum != 0},
            "unmapped_titles": [entry.key for entry in entries if entry.enum == 0],
        }

    async def _async_source_changed(self, event: Event) -> None:
        """Handle source entity state changes."""
        new_state = event.data.get("new_state")
        if new_state is not None:
            await self.async_process_state(new_state)

    async def async_process_state(self, state: State) -> None:
        """Extract and persist the current key."""
        key = self.key_from_state(state)
        if not key:
            return
        await self.store.async_seen(key)
        self.current_key = key
        self.refresh_current_enum()
        self._notify_listeners()

    def key_from_state(self, state: State) -> str | None:
        """Build the raw key string from a Home Assistant state."""
        watcher_type = self.entry.data[CONF_WATCHER_TYPE]
        title = self._title_from_attributes(state, watcher_type) or self._clean_value(state.state)
        if title is None:
            return None

        artist_attr = self.entry.data.get(CONF_ARTIST_ATTRIBUTE) or DEFAULT_ARTIST_ATTRIBUTE
        artist = self._clean_value(state.attributes.get(artist_attr))
        if watcher_type == "media" and artist:
            return f"{artist} - {title}"
        return title

    def _title_from_attributes(self, state: State, watcher_type: str) -> str | None:
        """Return the first useful title-like attribute for a watcher type."""
        for attribute in TITLE_ATTRIBUTE_CANDIDATES[watcher_type]:
            value = self._clean_value(state.attributes.get(attribute))
            if value is not None:
                return value
        return None

    def _clean_value(self, value: Any) -> str | None:
        """Normalise a candidate key value and drop unavailable/idling values."""
        if value is None:
            return None
        value = str(value).strip()
        if value.lower() in IGNORED_RAW_VALUES:
            return None
        return value

    def as_panel_dict(self) -> dict[str, Any]:
        """Return serialisable watcher and entry data for the panel."""
        return {
            "entry_id": self.entry.entry_id,
            "name": self.name,
            "source_entity": self.source_entity,
            "watcher_type": self.entry.data[CONF_WATCHER_TYPE],
            "retention_days": self.entry.options.get(CONF_RETENTION_DAYS),
            "current_key": self.current_key,
            "current_enum": self.current_enum,
            **self.catalog_summary(),
            "entries": [item.as_dict() for item in self.store.sorted_entries()],
        }


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up global ETM services and panel."""
    hass.data.setdefault(DOMAIN, {})
    await _async_register_services(hass)
    _async_register_websocket(hass)
    await _async_register_panel(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a watcher from a config entry."""
    runtime = WatcherRuntime(hass, entry)
    await runtime.async_setup()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = runtime
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a watcher config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    runtime = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if runtime is not None:
        await runtime.async_unload()
    return unload_ok


async def _async_register_services(hass: HomeAssistant) -> None:
    """Register ETM service handlers once."""
    if hass.services.has_service(DOMAIN, SERVICE_SET_ENUM):
        return

    async def async_set_enum(call: ServiceCall) -> None:
        runtime = _get_runtime(hass, call.data[ATTR_ENTRY_ID])
        await _async_set_enum(runtime, call.data[ATTR_KEY], call.data["enum"])

    async def async_import_entries(call: ServiceCall) -> None:
        runtime = _get_runtime(hass, call.data[ATTR_ENTRY_ID])
        entries = [_normalise_import_entry(item) for item in call.data[ATTR_ENTRIES]]
        await runtime.store.async_import_entries(entries)
        runtime.refresh_current_enum()
        runtime._notify_listeners()

    async def async_delete_entry(call: ServiceCall) -> None:
        runtime = _get_runtime(hass, call.data[ATTR_ENTRY_ID])
        deleted = await runtime.store.async_delete(call.data[ATTR_KEY])
        if deleted:
            runtime.refresh_current_enum()
            runtime._notify_listeners()

    async def async_clear_old(call: ServiceCall) -> None:
        entry_id = call.data.get(ATTR_ENTRY_ID)
        runtimes = [_get_runtime(hass, entry_id)] if entry_id else hass.data[DOMAIN].values()
        for runtime in runtimes:
            removed = await runtime.store.async_clear_old(call.data["days"])
            if removed:
                runtime.refresh_current_enum()
                runtime._notify_listeners()

    hass.services.async_register(DOMAIN, SERVICE_SET_ENUM, async_set_enum, schema=SET_ENUM_SCHEMA)
    hass.services.async_register(
        DOMAIN, SERVICE_DELETE_ENTRY, async_delete_entry, schema=DELETE_ENTRY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CLEAR_OLD, async_clear_old, schema=CLEAR_OLD_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_IMPORT_ENTRIES, async_import_entries, schema=IMPORT_ENTRIES_SCHEMA
    )


def _async_register_websocket(hass: HomeAssistant) -> None:
    """Register panel websocket commands."""

    @websocket_api.websocket_command({vol.Required("type"): "etm/list"})
    @websocket_api.async_response
    async def websocket_list(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
        connection.send_result(
            msg["id"], [runtime.as_panel_dict() for runtime in hass.data[DOMAIN].values()]
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "etm/set_enum",
            vol.Required(ATTR_ENTRY_ID): cv.string,
            vol.Required(ATTR_KEY): cv.string,
            vol.Required("enum"): vol.All(vol.Coerce(int), vol.Range(min=MIN_ENUM, max=MAX_ENUM)),
        }
    )
    @websocket_api.async_response
    async def websocket_set_enum(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
        runtime = _get_runtime(hass, msg[ATTR_ENTRY_ID])
        await _async_set_enum(runtime, msg[ATTR_KEY], msg["enum"])
        connection.send_result(msg["id"], runtime.as_panel_dict())

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "etm/delete_entry",
            vol.Required(ATTR_ENTRY_ID): cv.string,
            vol.Required(ATTR_KEY): cv.string,
        }
    )
    @websocket_api.async_response
    async def websocket_delete_entry(
        hass: HomeAssistant, connection, msg: dict[str, Any]
    ) -> None:
        runtime = _get_runtime(hass, msg[ATTR_ENTRY_ID])
        deleted = await runtime.store.async_delete(msg[ATTR_KEY])
        if deleted:
            runtime.refresh_current_enum()
            runtime._notify_listeners()
        connection.send_result(msg["id"], {ATTR_DELETED: deleted})

    @websocket_api.websocket_command(
        {
            vol.Required("type"): "etm/import_entries",
            vol.Required(ATTR_ENTRY_ID): cv.string,
            vol.Required(ATTR_ENTRIES): vol.All(cv.ensure_list, [IMPORT_ENTRY_SCHEMA]),
        }
    )
    @websocket_api.async_response
    async def websocket_import_entries(
        hass: HomeAssistant, connection, msg: dict[str, Any]
    ) -> None:
        runtime = _get_runtime(hass, msg[ATTR_ENTRY_ID])
        entries = [_normalise_import_entry(item) for item in msg[ATTR_ENTRIES]]
        await runtime.store.async_import_entries(entries)
        runtime.refresh_current_enum()
        runtime._notify_listeners()
        connection.send_result(msg["id"], runtime.as_panel_dict())

    websocket_api.async_register_command(hass, websocket_list)
    websocket_api.async_register_command(hass, websocket_set_enum)
    websocket_api.async_register_command(hass, websocket_delete_entry)
    websocket_api.async_register_command(hass, websocket_import_entries)


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Expose the ETM management panel."""
    frontend_path = Path(__file__).parent / "frontend" / "etm-panel.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_URL, str(frontend_path), False)]
    )
    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=DOMAIN,
        config={"_panel_custom": {"name": "etm-panel", "js_url": PANEL_URL}},
        require_admin=True,
    )

    @callback
    def _remove_panel(event: Event) -> None:
        hass.components.frontend.async_remove_panel(DOMAIN)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _remove_panel)


async def _async_set_enum(runtime: WatcherRuntime, key: str, enum: int) -> None:
    """Create or update one title mapping and refresh dependent entities."""
    key = _normalise_key(key)
    await runtime.store.async_set_enum(key, enum)
    runtime.refresh_current_enum()
    runtime._notify_listeners()


def _normalise_import_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Normalise one imported title mapping."""
    return {ATTR_KEY: _normalise_key(entry[ATTR_KEY]), "enum": entry["enum"]}


def _normalise_key(key: str) -> str:
    """Normalise a manually supplied title/key."""
    key = str(key).strip()
    if not key:
        raise ServiceValidationError("ETM key/title must not be empty")
    return key


def _get_runtime(hass: HomeAssistant, entry_id: str) -> WatcherRuntime:
    """Return a watcher runtime or raise a validation error."""
    try:
        return hass.data[DOMAIN][entry_id]
    except KeyError as err:
        raise ServiceValidationError(f"Unknown ETM watcher entry_id: {entry_id}") from err
