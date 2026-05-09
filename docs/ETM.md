# ETM – Entity Title Mapper

ETM is a Home Assistant custom integration that observes configured source entities,
persists every title/state value it sees for that one source entity, and exposes a numeric enum sensor for automations.

## Watchers

Create one watcher per source entity through the Home Assistant config flow:

- **Name**: used for the output entity IDs.
- **Source entity**: entity to observe.
- **Artist attribute**: optional media artist attribute, default `media_artist`.
- **Watcher type**: `game`, `media`, or `activity`. Game and activity watchers prefer title-like attributes (for example `media_title`, `game_title`, `game_name`, `app_name`, or `activity`) before falling back to the entity state, so sources such as a PS5 entity store the actual played title instead of only a generic state like `playing`.
- **Retention days**: optional value used by manual cleanup; empty means unlimited retention.

## Persistence

Each watcher stores its entries through Home Assistant storage using keys named
`etm_<config_entry_id>`, which Home Assistant writes below `.storage/` at runtime.
Every stored entry contains:

- `key`
- `enum` (`0`–`9`, default `0`)
- `first_seen`
- `last_seen`
- `seen_count`

## Output entities

For a watcher named `PlayStation Titles`, ETM creates:

- `sensor.etm_playstation_titles_enum` – mapped enum value (`0`–`9`) for the current title. This is the automation-facing output.
- `sensor.etm_playstation_titles_raw` – current raw title/key string.
- `sensor.etm_playstation_titles_catalog` – diagnostic catalog entity whose state is the number of tracked titles; attributes expose `known_titles`, `mapped_titles`, and `unmapped_titles`.
- `number.etm_playstation_titles_current_title_enum` – control for assigning the enum to the currently active title directly from the Home Assistant device/entity UI.

## Panel

The sidebar panel **Entity Title Mapper** lists all watcher entries, shows unmapped
entries (`enum = 0`) first, lets admins assign enum values, and supports manual deletion.

Each watcher has its own title catalog. ETM does **not** create a new Home Assistant
device for every PlayStation title; instead, all observed or manually maintained title
variants are stored below the watcher and are exposed through the catalog sensor
attributes.

The panel provides two maintenance paths per watcher:

- **Add/update one**: map the current or manually typed title to an enum.
- **Import/update list**: paste a title list with one mapping per line, for example:

```text
Astro's Playroom = 1
Diablo IV = 2
Ratchet & Clank: Rift Apart = 3
```

This lets a PlayStation title sensor keep a database of all played games while the main
output sensor only returns the enum for the title that is currently active. The enum is
the small automation code you define (for example `0`, `1`, or `2`); any number of
different titles can be tracked and assigned to those codes.

If Home Assistant already shows a current title such as `Diablo IV` on the device page,
open the `Current title enum` number entity and set it to the desired value. ETM then
stores the mapping `Diablo IV -> <enum>` and `sensor.etm_playstation_titles_enum` will
return that value whenever the raw title matches `Diablo IV`.

## Services

### `etm.set_enum`

Create or update a key and assign an enum value. This can be used to pre-map a game/title before it is observed automatically.

```yaml
entry_id: "01J..."
key: "Astro's Playroom"
enum: 7
```

### `etm.import_entries`

Create or update multiple title mappings for one watcher.

```yaml
entry_id: "01J..."
entries:
  - key: "Astro's Playroom"
    enum: 1
  - key: "Diablo IV"
    enum: 2
```

### `etm.delete_entry`

Delete a key from a watcher.

```yaml
entry_id: "01J..."
key: "Astro's Playroom"
```

### `etm.clear_old`

Manually remove old entries. Omit `entry_id` to clean all watchers.

```yaml
entry_id: "01J..."
days: 30
```
