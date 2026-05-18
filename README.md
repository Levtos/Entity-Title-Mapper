# Entity Title Mapper (ETM)

A Home Assistant custom integration that turns the volatile string a media,
game, or activity entity exposes — a song title, a game name, an
Activity-Watch window title, a Discord activity, anything — into a stable
numeric enum your automations can branch on, without hard-coding titles.

ETM keeps a **per-watcher catalog** of every title it has ever observed,
exposes a small set of **per-watcher sensors** for automations, and ships a
**Title Classifier** admin panel for inspecting and curating the catalog.

* **Sidebar entry** — *Title Classifier* (icon: `mdi:tag-multiple`)
* **Domain** — `etm`
* **HACS** — integration custom repository
* **Languages** — codebase + docs in English; panel UI is German

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Watchers](#watchers)
- [Entities created per watcher](#entities-created-per-watcher)
- [The Title Classifier panel](#the-title-classifier-panel)
- [Hide / Auto-hide / Recall flow](#hide--auto-hide--recall-flow)
- [Colour coding](#colour-coding)
- [Services](#services)
- [WebSocket API](#websocket-api)
- [Storage layout](#storage-layout)
- [Automation patterns](#automation-patterns)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Repository layout](#repository-layout)

---

## Why this exists

Plenty of Home Assistant integrations expose a `state` like `Diablo IV`,
`MEDUZA feat. Henry Camamile - Don't Wanna Go Home`, or
`firefox - reddit.com`. Automations want to **react** to those titles —
boost the volume on favourite songs, switch profiles when a specific
game launches, log focus time only for productive apps — but writing
state triggers for hundreds of distinct strings is brittle and never
quite captures what you mean.

ETM puts a small lookup table in front of each source: every observed
title gets stored and assigned a number from `0` to `9` ("enum"). Your
automation triggers on the enum, not the string. New titles appear in
the catalog as they are observed, default to enum `0` ("unclassified"),
and stay there until you classify them in the panel.

## Highlights

- **Per-watcher catalog** — every distinct title observed on a source
  is persisted with first/last-seen timestamps and a play count.
- **Numeric enum output** — `sensor.etm_<name>_enum` always reflects
  the enum for whatever is active right now (0 if the current title
  has not been classified yet).
- **Title Classifier panel** — sortable, filterable, paginated table
  of all entries across all watchers; click-to-edit enum value with
  per-row save; per-watcher legends.
- **Bulk import** — paste a `Title = N` list to seed mappings before
  the source has ever played them.
- **Auto-hide policy** — optional per-watcher rule that hides
  unclassified entries that have been silent for `N` hours, keeping
  the panel focused on what's actually current.
- **Reversible hide** — hide is never delete; an autocomplete widget
  lets you fetch any title (visible or hidden) back into the active
  view to classify it. Assigning a non-zero enum un-hides it.
- **Auto-resurface** — if the source plays a hidden title again it
  re-appears on its own (with a 5-minute grace window after manual
  hide so the currently-playing track doesn't fight the hide button).
- **Category & enum colour coding** — Dracula-inspired palette: the
  left rail of each row marks the watcher category (media / game /
  activity), a dot next to the value marks the enum (0-9).
- **Group by artist** — for media watchers with an artist attribute,
  collapsible groups per artist.
- **Admin-gated** — panel and all curate-side WebSocket commands
  require an HA admin account.

## Installation

### HACS

The repository ships with HACS metadata (`hacs.json`) and the standard
integration layout (`custom_components/etm/`).

1. **HACS → Integrations → ⋮ → Custom repositories**
2. Add this repository as **type: Integration**.
3. Install **Entity Title Mapper**, then restart Home Assistant.

### Manual

Copy `custom_components/etm/` into your Home Assistant `config/` directory
so the integration ends up at `config/custom_components/etm/`, then
restart Home Assistant.

## Quick start

1. Restart Home Assistant after installation.
2. **Settings → Devices & Services → Add Integration → Title Classifier**.
3. Pick a **Name**, a **Source entity** (e.g. `media_player.ps5` or
   `media_player.spotify`), and a **Watcher type**.
4. Open the **Title Classifier** sidebar entry. Whatever the source
   reports starts appearing in the table.
5. Assign enum values to the titles you care about: click the value
   `0`, type a number from `1` to `9`, click **Speichern**.
6. Wire `sensor.etm_<name>_enum` into your automations.

## Watchers

Each watcher is a separate config entry. Multiple watchers can observe
different source entities side-by-side.

| Field                | Required | Description |
| -------------------- | -------- | ----------- |
| **Name**             | yes      | Friendly name; used to derive entity slugs (e.g. *PlayStation Titles* → `sensor.etm_playstation_titles_enum`). |
| **Source entity**    | yes      | The HA entity ID to observe. |
| **Watcher type**     | yes      | One of `game`, `media`, `activity`. Controls how the title is extracted (see below). |
| **Artist attribute** | media    | Attribute used as artist prefix. Defaults to `media_artist`. |
| **Retention days**   | optional | Default age cutoff used by `etm.clear_old`. Empty = unlimited. |
| **Auto-hide hours**  | optional | Time after which unclassified entries are auto-hidden from the panel. `0` (default) disables auto-hide. |

### Watcher types

- **`media`** — looks at the source's `media_title` (plus the configured
  artist attribute) so the stored key looks like
  `Artist - Title`.
- **`game`** — prefers title-like attributes (`game_title`, `game_name`,
  `app_name`, etc.) before falling back to the entity state. A PS5
  media player whose state is just `playing` will still record the
  actual game.
- **`activity`** — similar to `game`, suited for activity-tracking
  entities and window-title sensors.

### Adding a watcher

**Settings → Devices & Services → ⋮ → Title Classifier → Add entry**.

## Entities created per watcher

For a watcher named *PlayStation Titles*:

| Entity                                                        | Purpose                                                                                                                |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sensor.etm_playstation_titles_enum`                          | Current mapped enum (`0`–`9`). The automation-facing output. `0` when the current title has not been classified yet.  |
| `sensor.etm_playstation_titles_raw`                           | Current raw title string. Diagnostic.                                                                                  |
| `sensor.etm_playstation_titles_catalog`                       | State = number of tracked titles. Attributes: `known_titles`, `mapped_titles`, `unmapped_titles`. Diagnostic.          |
| `number.etm_playstation_titles_current_title_enum`            | Direct setter for the enum of the currently active title — change it from the device page to assign without the panel. |

Slugs are derived from the watcher name. ETM does **not** create one HA
device per observed title — the entire catalog lives below the watcher.

## The Title Classifier panel

The panel registers itself in the sidebar after the first watcher exists
and is restricted to admin users.

### Layout

| Column          | Notes |
| --------------- | ----- |
| **Titel**       | Raw key. Shows an *aktiv* badge on the row whose key is currently playing/active on its source. |
| **Source**      | Watcher name. Coloured rail on the left marks the category. |
| **Wert**        | Editable enum `0`–`9`. Coloured dot next to the input previews the value. Border turns yellow while the value is `0`. **Speichern** stays disabled until the value differs from the saved one. |
| **Zuletzt**     | Relative "last seen" time. |

### Filters

- **Source** — narrow to one watcher, or stay on *Alle (N)*.
- **Nur unklassifiziert** — show only entries with enum `0`.
- **Titel suchen …** — case-insensitive substring search. **Filter
  anwenden** applies the search (also fires on Enter).
- **Nach Künstler** — group-by-artist for media watchers (collapsible
  groups, with **Alle ▸** / **Alle ▾** to fold or unfold every group).
- **Versteckte zeigen** — surface hidden entries in the main table
  (dimmed + italic). See [Hide / Auto-hide / Recall flow](#hide--auto-hide--recall-flow).
- **Ausblenden (N)** — visible only when a source filter is active and
  the source has unclassified entries; bulk-hides them with a confirm.

### Sorting

Click a column header to sort by that column; click again to reverse.
Default order: **Zuletzt** descending.

### Pagination

Tables longer than 100 rows are paginated. Page buttons + Prev/Next at
the bottom.

### Auto-refresh

The panel re-fetches the catalog every 30 seconds; the **↻** button
forces an immediate reload.

### "Eintrag vervollständigen" (autocomplete recall)

Below the toolbar a search box reads
**Eintrag vervollständigen — versteckte Titel suchen …**. As you type
(min. 2 chars, debounced) the panel queries `etm/list_entries` with
`include_hidden: true` and shows up to 25 matches with the source name,
current enum, hidden flag, and last-seen time. Clicking a hit jumps the
main view to that exact entry (sets the source filter, fills the search
box, enables *Versteckte zeigen*) so you can classify it in place.
Classifying with any value `!= 0` un-hides the entry permanently.

### Legend

The **Legende ▾** button opens an explanatory panel:

- A **Kategorie-Streifen** section showing the colour for each watcher
  type that is currently in view.
- One **Enum table** per category that lists the meaning ETM assigns to
  each value (e.g. media: `1 = boost`, `2 = mute`).

## Hide / Auto-hide / Recall flow

ETM never deletes entries on its own — every "hide" is reversible.

### Auto-hide (per watcher, optional)

Set **Auto-hide hours** in the watcher options to e.g. `24`. An entry
is then considered hidden if it has enum `0` **and** has not been
observed in the last `24` hours. The rule is derived at read time from
`last_seen`, so:

- The next play of a hidden title bumps `last_seen` and the title
  reappears on its own.
- Classifying a title (enum `!= 0`) makes the auto-hide rule no longer
  apply.

`auto_hide_hours = 0` (default) disables auto-hide entirely.

### Manual bulk hide

The **Ausblenden (N)** button stores a `hidden_at` timestamp on every
unmapped entry of the selected source. This is independent of
`last_seen`, so the entries stay out of the way even if they continue
to be played.

### Grace window

A manually-hidden entry will only resurface on a future `async_seen`
event once its `hidden_at` is at least **5 minutes** old. This prevents
the currently-playing title from immediately re-appearing the moment
you click *Ausblenden*.

### Bringing hidden entries back

- The **Versteckte zeigen** toggle includes them in the main table
  (dimmed) so you can edit them directly.
- The **Eintrag vervollständigen** autocomplete searches across all
  entries — visible and hidden alike — and jumps the main view to a
  picked entry so you can classify it.
- Assigning enum `!= 0` always clears `hidden_at`, so classifying is
  the natural "un-hide".

## Colour coding

The panel applies two independent visual layers.

### Category rail (left border of each row)

| Watcher type | Colour                  |
| ------------ | ----------------------- |
| `media`      | Dracula purple `#bd93f9` |
| `game`       | Dracula green  `#50fa7b` |
| `activity`   | Dracula orange `#ffb86c` |

### Enum dot (next to the value input)

| Value | Colour                         |
| ----- | ------------------------------ |
| `0`   | Dracula comment `#6272a4`      |
| `1`   | Dracula red `#ff5555`          |
| `2`   | Dracula orange `#ffb86c`       |
| `3`   | Dracula yellow `#f1fa8c`       |
| `4`   | Dracula green `#50fa7b`        |
| `5`   | Dracula cyan `#8be9fd`         |
| `6`   | Dracula purple `#bd93f9`       |
| `7`   | Dracula pink `#ff79c6`         |
| `8`   | Dracula foreground `#f8f8f2`   |
| `9`   | Dracula selection `#44475a`    |

The dot updates live as you type before you save. While the input still
holds `0`, its border is highlighted in the HA warning colour — a
gentle nudge that an entry is unclassified.

Both palettes are declared as CSS variables (`--etm-cat-*`,
`--etm-enum-*`) at the top of `custom_components/etm/frontend/etm-panel.js`;
re-skinning is a one-line change per colour.

## Services

All services accept a `entry_id` referring to the watcher's config
entry ID (visible in **Settings → Devices & Services →** the watcher
**→ ⋮ → System Information**).

### `etm.set_enum`

Create or update a single title's enum.

```yaml
service: etm.set_enum
data:
  entry_id: "01J..."
  key: "Astro's Playroom"
  enum: 1
```

### `etm.import_entries`

Bulk import or update a list of mappings for one watcher.

```yaml
service: etm.import_entries
data:
  entry_id: "01J..."
  entries:
    - key: "Astro's Playroom"
      enum: 1
    - key: "Diablo IV"
      enum: 2
    - key: "Ratchet & Clank: Rift Apart"
      enum: 3
```

### `etm.delete_entry`

Permanently remove a single title from a watcher.

```yaml
service: etm.delete_entry
data:
  entry_id: "01J..."
  key: "Astro's Playroom"
```

### `etm.clear_old`

Delete entries whose `last_seen` is older than `days`. Omit `entry_id`
to clean every watcher.

```yaml
service: etm.clear_old
data:
  entry_id: "01J..."   # optional
  days: 30
```

## WebSocket API

All commands are dispatched on the standard HA WebSocket API. Admin-gated
commands enforce the check server-side via `@websocket_api.require_admin`.

| Command                 | Admin | Purpose |
| ----------------------- | ----- | ------- |
| `etm/list`              |  no   | All watchers with their full catalog. Used by the legacy/list view. |
| `etm/set_enum`          |  no   | Map a key to an enum for one watcher. |
| `etm/delete_entry`      |  no   | Remove a key from one watcher. |
| `etm/import_entries`    |  no   | Bulk-import `{key, enum}[]` for one watcher. |
| `etm/get_sources`       | **yes** | All watchers with metadata: `entry_count`, `unmapped_count`, `hidden_count`, `auto_hide_hours`, `watcher_type`. |
| `etm/list_entries`      | **yes** | Flat list of entries. Optional params: `source`, `unclassified`, `search`, `include_hidden`, `limit`. |
| `etm/update_entry`      | **yes** | Update enum for one entry (`entry_id`, `key`, `enum_value` 0-9). |
| `etm/hide_unmapped`     | **yes** | Bulk-set `hidden_at` on every unmapped entry of one watcher. Returns `{ hidden: N }`. |

Each entry returned by `etm/list_entries` carries:

```jsonc
{
  "entry_id":     "01J...",     // config entry of the source watcher
  "source_name":  "Musik",
  "watcher_type": "media",
  "key":          "AVICII - Levels",
  "enum":         0,
  "first_seen":   "2025-…",
  "last_seen":    "2026-05-18T…",
  "seen_count":   12,
  "is_current":   false,        // true if currently playing on the source
  "hidden":       true,         // derived from hidden_at + auto-hide rule
  "hidden_at":    "2026-05-17…" // null when not manually hidden
}
```

## Storage layout

Each watcher's data lives in Home Assistant's `Store` API under
`config/.storage/etm_<config_entry_id>`. The file is JSON with one
record per observed key:

```json
{
  "version": 1,
  "minor_version": 1,
  "key": "etm_01J…",
  "data": {
    "entries": {
      "MEDUZA feat. Henry Camamile - Don't Wanna Go Home": {
        "key":        "MEDUZA feat. Henry Camamile - Don't Wanna Go Home",
        "enum":       1,
        "first_seen": "2026-05-01T18:42:11+00:00",
        "last_seen":  "2026-05-18T13:05:02+00:00",
        "seen_count": 7,
        "hidden_at":  null
      }
    }
  }
}
```

The integration always serialises new entries with `hidden_at`; missing
fields on older data are defaulted on load, so the file format remains
backward-compatible without a migration.

## Automation patterns

### Music boost on favourite tracks

Map favourites to enum `1` in the panel. Then:

```yaml
alias: Favourite track — louder
trigger:
  - platform: state
    entity_id: sensor.etm_musik_enum
    to: "1"
action:
  - service: media_player.volume_set
    target:
      entity_id: media_player.spotify
    data:
      volume_level: 0.85
```

### Mute on disliked tracks

```yaml
alias: Skip-list — mute
trigger:
  - platform: state
    entity_id: sensor.etm_musik_enum
    to: "2"
action:
  - service: media_player.volume_set
    target:
      entity_id: media_player.spotify
    data:
      volume_level: 0
```

### Game mode by title

```yaml
alias: Diablo IV → grind profile
trigger:
  - platform: state
    entity_id: sensor.etm_ps5_enum
    to: "1"
action:
  - service: scene.turn_on
    target:
      entity_id: scene.gaming_grind
```

### Pre-seed before the source has ever played

Use `etm.import_entries` to seed a known catalogue (e.g. your Steam
library) so first launches already route correctly.

## Troubleshooting

### Panel UI does not reflect my changes after an update

Home Assistant caches the panel JS aggressively. ETM bumps a versioned
URL (`/etm_panel_v8.js` and counting) on every breaking frontend change,
which makes browsers fetch the new file. After updating, do a
**hard refresh** (Ctrl+Shift+R / ⌘+Shift+R) or clear cached files for
your HA host.

### "Title Classifier" entry not visible in sidebar

The panel registers itself with `require_admin=True`. Log in with an
admin account. Restart HA once after the first install to make sure
the panel is registered with the frontend.

### Catalog counts don't match

`entry_count` includes hidden entries; the visible table count and
`unmapped_count` / `hidden_count` are separate fields. The info line
under the toolbar always shows the three together — visible vs.
filtered total vs. unclassified vs. hidden.

### Manual *Ausblenden* but the active track came back

Resolved since the grace-window change: a manually-hidden entry now
needs to be silent for **5 minutes** before `async_seen` will resurface
it. Until then the active title stays hidden.

### A title shows up under the wrong source

Each watcher decides on its own what attribute to read (see watcher
types). For media players that expose a generic state, prefer the
`media` type so the title is taken from `media_title`. For sources
that already report the title in `state`, `activity` works well.

## Development

### Health check

```bash
bash scripts/repo_health_check.sh
```

Runs the HACS structure + manifest sanity checks. CI uses the same
script.

### Branch convention

This repo uses Claude-flavoured feature branches for the cloud agent:
all development for this engagement happens on
`claude/optimize-entity-tracking-…`. PRs target `main`.

### Tests

Backend code is plain `dataclass` + Home Assistant `Store`; no test
suite is shipped yet. The health check + manifest validation are the
existing gates.

## Repository layout

```
.
├─ custom_components/etm/        Integration source
│  ├─ __init__.py                Setup, WS commands, services, runtime
│  ├─ config_flow.py             UI + options flow
│  ├─ const.py                   Constants (incl. panel URL, watcher types)
│  ├─ sensor.py / number.py      HA entities
│  ├─ storage.py                 MapperStore + MapperEntry persistence
│  ├─ services.yaml              Service schemas
│  ├─ manifest.json              HACS / HA manifest
│  ├─ translations/{de,en}.json  Config + options flow strings
│  ├─ frontend/etm-panel.js      Title Classifier panel (web component)
│  └─ README.md                  Panel-focused reference
├─ docs/
│  ├─ ETM.md                     Service-by-service reference
│  └─ HACS.md                    HACS layout notes
├─ scripts/repo_health_check.sh  CI / local health gate
├─ hacs.json                     HACS metadata
└─ README.md                     This file
```
