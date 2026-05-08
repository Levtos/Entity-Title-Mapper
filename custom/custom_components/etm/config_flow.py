"""Config flow for Entity Title Mapper."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.helpers import selector

from .const import (
    CONF_ARTIST_ATTRIBUTE,
    CONF_RETENTION_DAYS,
    CONF_SOURCE_ENTITY,
    CONF_WATCHER_TYPE,
    DEFAULT_ARTIST_ATTRIBUTE,
    DOMAIN,
    WATCHER_TYPES,
)


class EtmConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle an ETM watcher config flow."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Create a watcher."""
        errors: dict[str, str] = {}
        if user_input is not None:
            await self.async_set_unique_id(user_input[CONF_NAME].lower().replace(" ", "_"))
            self._abort_if_unique_id_configured()
            data = {
                CONF_NAME: user_input[CONF_NAME],
                CONF_SOURCE_ENTITY: user_input[CONF_SOURCE_ENTITY],
                CONF_ARTIST_ATTRIBUTE: user_input.get(CONF_ARTIST_ATTRIBUTE)
                or DEFAULT_ARTIST_ATTRIBUTE,
                CONF_WATCHER_TYPE: user_input[CONF_WATCHER_TYPE],
            }
            options = {CONF_RETENTION_DAYS: user_input.get(CONF_RETENTION_DAYS)}
            return self.async_create_entry(title=user_input[CONF_NAME], data=data, options=options)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME): selector.TextSelector(),
                    vol.Required(CONF_SOURCE_ENTITY): selector.EntitySelector(),
                    vol.Optional(
                        CONF_ARTIST_ATTRIBUTE, default=DEFAULT_ARTIST_ATTRIBUTE
                    ): selector.TextSelector(),
                    vol.Required(CONF_WATCHER_TYPE, default="media"): selector.SelectSelector(
                        selector.SelectSelectorConfig(options=WATCHER_TYPES)
                    ),
                    vol.Optional(CONF_RETENTION_DAYS): selector.NumberSelector(
                        selector.NumberSelectorConfig(min=1, mode="box")
                    ),
                }
            ),
            errors=errors,
        )

    @staticmethod
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> EtmOptionsFlow:
        """Return the options flow."""
        return EtmOptionsFlow(config_entry)


class EtmOptionsFlow(config_entries.OptionsFlow):
    """Handle watcher options."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialise options flow."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Edit retention options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_RETENTION_DAYS,
                        default=self._config_entry.options.get(CONF_RETENTION_DAYS),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(min=1, mode="box")
                    )
                }
            ),
        )
