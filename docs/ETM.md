# ETM – Entity Title Mapper

ETM is a Home Assistant custom integration that observes configured source entities,
persists every raw key it sees, and exposes a numeric enum sensor for automations.

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

For a watcher named `Living Room Media`, ETM creates:

- `sensor.etm_living_room_media_enum` – mapped enum value (`0`–`9`).
- `sensor.etm_living_room_media_raw` – current raw key string.

## Panel

The sidebar panel **Entity Title Mapper** lists all watcher entries, shows unmapped
entries (`enum = 0`) first, lets admins assign enum values, and supports manual deletion.

Each watcher also has an **Add/update** form. Use it to type a title manually and assign
an enum even before ETM has seen that title. The form is pre-filled with the current
title when one is available, so a PS5/game watcher can quickly map the current game and
will keep all previously seen or manually added games in the table.

## Services

### `etm.set_enum`

Create or update a key and assign an enum value. This can be used to pre-map a game/title before it is observed automatically.

```yaml
entry_id: "01J..."
key: "Astro's Playroom"
enum: 7
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
