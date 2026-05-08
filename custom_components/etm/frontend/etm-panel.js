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
    await this._hass.connection.sendMessagePromise({
      type: "etm/set_enum",
      entry_id: entryId,
      key,
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
        button, select { font: inherit; }
        table { border-collapse: collapse; width: 100%; background: var(--card-background-color); }
        th, td { border-bottom: 1px solid var(--divider-color); padding: 10px; text-align: left; }
        th { font-weight: 600; }
        tr.unmapped { background: color-mix(in srgb, var(--warning-color, #ffa600) 18%, transparent); }
        .empty { opacity: 0.7; padding: 24px; text-align: center; }
        .key { font-family: var(--code-font-family, monospace); }
      </style>
      <div class="toolbar">
        <h1>Entity Title Mapper</h1>
        <button id="refresh">Refresh</button>
      </div>
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
          ${rows.length === 0 ? `<tr><td class="empty" colspan="7">No ETM entries have been seen yet.</td></tr>` : ""}
          ${rows.map(({ watcher, entry }) => `
            <tr class="${entry.enum === 0 ? "unmapped" : ""}">
              <td>${this._escape(watcher.name)}</td>
              <td class="key">${this._escape(entry.key)}</td>
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
