class EtmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._watchers = [];
    this._loading = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loading && this._watchers.length === 0) {
      this._refresh();
    }
  }

  connectedCallback() {
    this._render();
  }

  async _refresh() {
    if (!this._hass) return;
    this._loading = true;
    try {
      this._watchers = await this._hass.connection.sendMessagePromise({ type: "etm/list" });
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _setEnum(entryId, key, enumValue) {
    if (!key?.trim()) return;
    await this._hass.connection.sendMessagePromise({
      type: "etm/set_enum",
      entry_id: entryId,
      key: key.trim(),
      enum: Number(enumValue),
    });
    await this._refresh();
  }

  async _deleteEntry(entryId, key) {
    if (!confirm(`Delete ETM entry "${key}"?`)) return;
    await this._hass.connection.sendMessagePromise({
      type: "etm/delete_entry",
      entry_id: entryId,
      key,
    });
    await this._refresh();
  }

  _render() {
    if (!this.shadowRoot) return;
    const rows = this._watchers.flatMap((watcher) =>
      watcher.entries.map((entry) => ({ watcher, entry }))
    );
    rows.sort((left, right) => {
      if (left.entry.enum === 0 && right.entry.enum !== 0) return -1;
      if (left.entry.enum !== 0 && right.entry.enum === 0) return 1;
      return left.entry.key.localeCompare(right.entry.key);
    });

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 24px; color: var(--primary-text-color); }
        .toolbar { align-items: center; display: flex; gap: 12px; margin-bottom: 16px; }
        .watchers { display: grid; gap: 16px; margin-bottom: 24px; }
        .watcher-card { background: var(--card-background-color); border-radius: 12px; box-shadow: var(--ha-card-box-shadow, none); padding: 16px; }
        .watcher-card h2 { margin: 0 0 8px; }
        .meta { opacity: 0.75; }
        .current { margin: 12px 0; }
        .add-row { align-items: end; display: grid; gap: 8px; grid-template-columns: minmax(220px, 1fr) 90px auto; }
        label { display: grid; gap: 4px; }
        input, button, select { font: inherit; }
        table { border-collapse: collapse; width: 100%; background: var(--card-background-color); }
        th, td { border-bottom: 1px solid var(--divider-color); padding: 10px; text-align: left; }
        th { font-weight: 600; }
        tr.unmapped { background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent); }
        tr.current { outline: 2px solid var(--primary-color); outline-offset: -2px; }
        .empty { opacity: 0.7; padding: 24px; text-align: center; }
        .key { font-family: var(--code-font-family, monospace); }
        .badge { border-radius: 999px; background: var(--primary-color); color: var(--text-primary-color); display: inline-block; font-size: 0.8em; margin-left: 8px; padding: 2px 8px; }
      </style>
      <div class="toolbar">
        <h1>Entity Title Mapper</h1>
        <button id="refresh">Refresh</button>
      </div>
      <section class="watchers">
        ${this._watchers.length === 0 ? `<div class="empty">No ETM watchers are configured.</div>` : ""}
        ${this._watchers.map((watcher) => `
          <article class="watcher-card">
            <h2>${this._escape(watcher.name)}</h2>
            <div class="meta">${this._escape(watcher.source_entity)} · ${this._escape(watcher.watcher_type)}</div>
            <div class="current">
              Current title: <span class="key">${this._escape(watcher.current_key ?? "—")}</span>
              <span class="badge">Enum ${watcher.current_enum ?? 0}</span>
            </div>
            <form class="add-row" data-entry-id="${this._escape(watcher.entry_id)}">
              <label>
                Title/key to map
                <input name="key" placeholder="e.g. Astro's Playroom" value="${this._escape(watcher.current_key ?? "")}" />
              </label>
              <label>
                Enum
                <select name="enum">
                  ${Array.from({ length: 10 }, (_, value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
              </label>
              <button type="submit">Add/update</button>
            </form>
          </article>
        `).join("")}
      </section>
      <table>
        <thead>
          <tr>
            <th>Watcher</th>
            <th>Key</th>
            <th>Enum</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th>Seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? `<tr><td class="empty" colspan="7">No ETM entries have been seen or added yet.</td></tr>` : ""}
          ${rows.map(({ watcher, entry }) => `
            <tr class="${entry.enum === 0 ? "unmapped" : ""} ${entry.key === watcher.current_key ? "current" : ""}">
              <td>${this._escape(watcher.name)}</td>
              <td class="key">${this._escape(entry.key)}${entry.key === watcher.current_key ? `<span class="badge">current</span>` : ""}</td>
              <td>
                <select data-action="enum" data-entry-id="${this._escape(watcher.entry_id)}" data-key="${this._escape(entry.key)}">
                  ${Array.from({ length: 10 }, (_, value) => `<option value="${value}" ${value === entry.enum ? "selected" : ""}>${value}</option>`).join("")}
                </select>
              </td>
              <td>${this._formatDate(entry.first_seen)}</td>
              <td>${this._formatDate(entry.last_seen)}</td>
              <td>${entry.seen_count}</td>
              <td><button data-action="delete" data-entry-id="${this._escape(watcher.entry_id)}" data-key="${this._escape(entry.key)}">Delete</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    this.shadowRoot.getElementById("refresh")?.addEventListener("click", () => this._refresh());
    this.shadowRoot.querySelectorAll('form.add-row').forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        this._setEnum(form.dataset.entryId, formData.get("key"), formData.get("enum"));
      });
    });
    this.shadowRoot.querySelectorAll('select[data-action="enum"]').forEach((select) => {
      select.addEventListener("change", (event) => {
        const target = event.currentTarget;
        this._setEnum(target.dataset.entryId, target.dataset.key, target.value);
      });
    });
    this.shadowRoot.querySelectorAll('button[data-action="delete"]').forEach((button) => {
      button.addEventListener("click", (event) => {
        const target = event.currentTarget;
        this._deleteEntry(target.dataset.entryId, target.dataset.key);
      });
    });
  }

  _formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("etm-panel", EtmPanel);
