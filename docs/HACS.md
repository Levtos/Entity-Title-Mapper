# HACS compatibility

Short answer: **yes, this repository uses the standard HACS integration layout and keeps binary brand assets out of the repository**.

The repository exposes the integration at:

```text
custom_components/etm/
```

from the repository root, with all runtime files inside that directory. The integration manifest includes the required `domain`, `documentation`, `issue_tracker`, `codeowners`, `name`, and `version` fields.

The repository also ships root-level HACS metadata:

```json
{
  "name": "Entity Title Mapper",
  "render_readme": true
}
```

This is the layout HACS expects when the repository is added as an integration custom repository. Binary brand assets such as `brand/icon.png` are intentionally not committed here; branding should be handled through the Home Assistant Brands process when publishing more broadly.
