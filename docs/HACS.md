# HACS compatibility

Short answer: **not fully, in the current repository layout**.

The ETM integration itself now contains the Home Assistant/HACS-required
`manifest.json` fields, including `domain`, `documentation`, `issue_tracker`,
`codeowners`, `name`, and `version`.

However, HACS expects an integration repository to expose the integration at:

```text
custom_components/etm/
```

from the repository root, with all runtime files inside that directory. This
repository currently keeps the integration below:

```text
custom/custom_components/etm/
```

That path is suitable for copying into a Home Assistant config directory, but it
is **not the standard HACS repository layout** when this repository root is added
as a HACS custom repository.

## What is still needed for direct HACS installation

To make this repository directly installable through HACS, a follow-up change
must either:

1. move/copy `custom/custom_components/etm/` to root-level
   `custom_components/etm/`, or
2. publish a dedicated HACS repository/release whose root contains
   `custom_components/etm/`.

A root-level `hacs.json` can then be added for HACS UI metadata, for example:

```json
{
  "name": "Entity Title Mapper",
  "render_readme": true
}
```

The current project instructions restrict changes to `custom/`, `docs/`, and
`scripts/`, so this PR does not create root-level HACS files or root-level
`custom_components/` paths.
