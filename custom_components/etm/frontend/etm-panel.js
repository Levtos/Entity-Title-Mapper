// ETM Title Classifier panel — plain custom element, no build step required.
// Uses Shadow DOM so HA styles don't leak in, and uses HA CSS variables for
// consistent Light/Dark theming.

class EtmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._sources = [];
    this._entries = [];
    this._loading = false;
    this._saving = false;

    // Filter state
    this._filterSource = "";
    this._filterUnclassified = false;
    this._filterSearch = "";

    // Sort state — default: last_seen descending (newest first)
    this._sortBy = "last_seen";
    this._sortAsc = false;

    // Pagination
    this._page = 1;
    this._pageSize = 100;

    // Inline-edit: stores "entry_id::key" of the row currently being edited
    this._editingKey = null;

    this._refreshTimer = null;
  }

  // HA sets this property whenever the hass object changes
  set hass(hass) {
    this._hass = hass;
    if (!this._loading && this._sources.length === 0) {
      this._initialLoad();
    }
  }

  connectedCallback() {
    this._render();
    this._refreshTimer = setInterval(() => this._loadEntries(), 30_000);
  }

  disconnectedCallback() {
    clearInterval(this._refreshTimer);
    this._refreshTimer = null;
  }

  // ------------------------------------------------------------------ data --

  async _initialLoad() {
    await Promise.all([this._loadSources(), this._loadEntries()]);
  }

  async _loadSources() {
    if (!this._hass) return;
    try {
      this._sources = await this._hass.connection.sendMessagePromise({
        type: "etm/get_sources",
      });
    } catch (err) {
      this._toast(`Failed to load sources: ${err.message}`, "error");
    }
    this._render();
  }

  async _loadEntries() {
    if (!this._hass) return;
    this._loading = true;
    this._render();
    try {
      const msg = { type: "etm/list_entries" };
      if (this._filterSource) msg.source = this._filterSource;
      if (this._filterUnclassified) msg.unclassified = true;
      if (this._filterSearch.trim()) msg.search = this._filterSearch.trim();
      this._entries = await this._hass.connection.sendMessagePromise(msg);
      this._page = 1;
    } catch (err) {
      this._toast(`Failed to load entries: ${err.message}`, "error");
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _updateEntry(entryId, key, rawValue) {
    if (this._saving) return false;
    const value = parseInt(rawValue, 10);
    if (isNaN(value) || value < 0 || value > 9) {
      this._toast("Value must be an integer 0–9", "error");
      return false;
    }
    this._saving = true;
    try {
      await this._hass.connection.sendMessagePromise({
        type: "etm/update_entry",
        entry_id: entryId,
        key,
        enum_value: value,
      });
      // Optimistic local update so re-render is instant
      const entry = this._entries.find(
        (e) => e.entry_id === entryId && e.key === key
      );
      if (entry) entry.enum = value;
      this._editingKey = null;
      this._toast("Saved", "success");
      this._render();
      return true;
    } catch (err) {
      this._toast(`Save failed: ${err.message}`, "error");
      return false;
    } finally {
      this._saving = false;
    }
  }

  // ---------------------------------------------------------------- sorting --

  _sortedEntries() {
    const entries = [...this._entries];
    entries.sort((a, b) => {
      let cmp;
      switch (this._sortBy) {
        case "key":
          cmp = a.key.localeCompare(b.key);
          break;
        case "enum":
          cmp = a.enum - b.enum;
          break;
        default: // last_seen
          cmp = new Date(a.last_seen) - new Date(b.last_seen);
      }
      return this._sortAsc ? cmp : -cmp;
    });
    return entries;
  }

  _toggleSort(col) {
    if (this._sortBy === col) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortBy = col;
      // last_seen defaults desc (newest first); others default asc
      this._sortAsc = col !== "last_seen";
    }
    this._render();
  }

  // ----------------------------------------------------------------- render --

  _render() {
    if (!this.shadowRoot) return;

    const sorted = this._sortedEntries();
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
    const page = Math.min(this._page, totalPages);
    const pageRows = sorted.slice((page - 1) * this._pageSize, page * this._pageSize);

    const arrow = (col) => {
      if (this._sortBy !== col) return "<span class='sort-hint'>↕</span>";
      return this._sortAsc
        ? "<span class='sort-active'>↑</span>"
        : "<span class='sort-active'>↓</span>";
    };

    this.shadowRoot.innerHTML = `
<style>
  :host {
    display: block;
    padding: 24px;
    color: var(--primary-text-color);
    background: var(--primary-background-color);
    min-height: 100%;
    box-sizing: border-box;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  }
  h1 {
    margin: 0 0 20px;
    font-size: 1.5rem;
    font-weight: 400;
  }

  /* ---- toolbar ---- */
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
    background: var(--card-background-color);
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
  }
  .filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  select, input[type="text"] {
    background: var(--input-fill-color, var(--secondary-background-color));
    border: 1px solid var(--input-ink-color, var(--secondary-text-color));
    border-radius: 4px;
    color: var(--primary-text-color);
    font: inherit;
    height: 34px;
    padding: 0 10px;
  }
  select { min-width: 130px; }
  input[type="text"] { min-width: 190px; }
  input[type="checkbox"] { cursor: pointer; }
  button {
    background: var(--primary-color);
    border: none;
    border-radius: 4px;
    color: var(--text-primary-color, #fff);
    cursor: pointer;
    font: inherit;
    height: 34px;
    padding: 0 14px;
    transition: opacity .15s;
  }
  button:hover { opacity: .85; }
  button:disabled { opacity: .4; cursor: default; }
  button.ghost {
    background: transparent;
    border: 1px solid var(--divider-color);
    color: var(--primary-text-color);
  }

  /* ---- table ---- */
  .results-info {
    margin-bottom: 8px;
    font-size: .85rem;
    color: var(--secondary-text-color);
  }
  .table-wrap {
    background: var(--card-background-color);
    border-radius: 8px;
    box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
    overflow-x: auto;
    transition: opacity .2s;
  }
  .table-wrap.loading { opacity: .5; pointer-events: none; }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: .95rem;
  }
  thead th {
    background: var(--table-header-background-color, var(--secondary-background-color));
    border-bottom: 2px solid var(--divider-color);
    cursor: pointer;
    font-weight: 600;
    padding: 11px 16px;
    text-align: left;
    user-select: none;
    white-space: nowrap;
  }
  thead th:hover { background: color-mix(in srgb, var(--primary-color) 10%, var(--secondary-background-color)); }
  .sort-hint { opacity: .35; }
  .sort-active { color: var(--primary-color); }
  td {
    border-bottom: 1px solid var(--divider-color);
    padding: 9px 16px;
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }

  /* highlight unclassified rows with a left accent */
  tr.unmapped td:first-child { border-left: 3px solid var(--warning-color, #ffa600); }
  /* highlight current-title row */
  tr.is-current { background: color-mix(in srgb, var(--primary-color) 7%, transparent); }

  .key-cell {
    font-family: var(--code-font-family, monospace);
    font-size: .9rem;
    max-width: 380px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    background: var(--primary-color);
    border-radius: 999px;
    color: #fff;
    display: inline-block;
    font-size: .72rem;
    margin-left: 6px;
    padding: 1px 7px;
    vertical-align: middle;
  }
  .source-chip {
    background: var(--secondary-background-color);
    border-radius: 4px;
    font-size: .82rem;
    padding: 2px 8px;
    white-space: nowrap;
  }

  /* inline enum edit */
  .enum-cell { width: 90px; }
  .enum-display {
    background: var(--secondary-background-color);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    cursor: pointer;
    display: inline-block;
    font-weight: 600;
    min-width: 38px;
    padding: 4px 10px;
    text-align: center;
    transition: background .15s;
  }
  .enum-display:hover {
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    border-color: var(--primary-color);
  }
  .enum-display.zero { color: var(--warning-color, #ffa600); }
  .enum-input {
    background: var(--input-fill-color, var(--secondary-background-color));
    border: 2px solid var(--primary-color);
    border-radius: 4px;
    color: var(--primary-text-color);
    font: inherit;
    font-weight: 600;
    text-align: center;
    width: 60px;
    height: 32px;
    padding: 0 4px;
  }
  .enum-input.invalid { border-color: var(--error-color, #f44336); }

  /* empty / loading state */
  .empty {
    color: var(--secondary-text-color);
    padding: 40px;
    text-align: center;
  }

  /* pagination */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 14px;
  }
  .pagination button { min-width: 36px; padding: 0 8px; }
  .pagination button.active {
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .page-info { font-size: .85rem; color: var(--secondary-text-color); }

  /* toast notification */
  .toast {
    animation: toast-in .2s ease;
    background: var(--primary-color);
    border-radius: 8px;
    bottom: 28px;
    box-shadow: 0 4px 14px rgba(0,0,0,.25);
    color: #fff;
    font-size: .9rem;
    padding: 12px 20px;
    position: fixed;
    right: 28px;
    z-index: 9999;
    max-width: 320px;
  }
  .toast.error  { background: var(--error-color,   #f44336); }
  .toast.success { background: var(--success-color, #4caf50); }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: none; }
  }
</style>

<h1>Title Classifier</h1>

<div class="toolbar">
  <div class="filter-group">
    <label for="f-source">Source</label>
    <select id="f-source">
      <option value="">All</option>
      ${this._sources
        .map(
          (s) =>
            `<option value="${this._esc(s.entry_id)}"${
              this._filterSource === s.entry_id ? " selected" : ""
            }>${this._esc(s.name)}</option>`
        )
        .join("")}
    </select>
  </div>
  <div class="filter-group">
    <input type="checkbox" id="f-unclassified"${
      this._filterUnclassified ? " checked" : ""
    } />
    <label for="f-unclassified">Unclassified only</label>
  </div>
  <div class="filter-group">
    <input type="text" id="f-search" placeholder="Search titles…"
           value="${this._esc(this._filterSearch)}" />
  </div>
  <button id="btn-apply">Apply</button>
  <button id="btn-refresh" class="ghost">↻ Refresh</button>
</div>

<div class="results-info">
  ${
    this._loading
      ? "Loading…"
      : `${sorted.length} entr${sorted.length === 1 ? "y" : "ies"}${
          totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""
        }`
  }
</div>

<div class="table-wrap${this._loading ? " loading" : ""}">
  <table>
    <thead>
      <tr>
        <th id="th-key">Title ${arrow("key")}</th>
        <th>Source</th>
        <th id="th-enum" class="enum-cell">Value ${arrow("enum")}</th>
        <th id="th-last-seen">Last Seen ${arrow("last_seen")}</th>
      </tr>
    </thead>
    <tbody>
      ${
        pageRows.length === 0
          ? `<tr><td class="empty" colspan="4">${
              this._loading ? "Loading…" : "No entries found."
            }</td></tr>`
          : pageRows.map((e) => this._rowHtml(e)).join("")
      }
    </tbody>
  </table>
</div>

${totalPages > 1 ? this._paginationHtml(page, totalPages) : ""}
`;

    this._attachEvents(page, totalPages);
    // Autofocus the inline input if we just opened an edit row
    const activeInput = this.shadowRoot.querySelector(".enum-input");
    if (activeInput) { activeInput.focus(); activeInput.select(); }
  }

  _rowHtml(entry) {
    const ek = this._editKey(entry.entry_id, entry.key);
    const editing = this._editingKey === ek;
    const cls = [
      entry.enum === 0 ? "unmapped" : "",
      entry.is_current ? "is-current" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `
<tr class="${cls}"
    data-entry-id="${this._esc(entry.entry_id)}"
    data-key="${this._esc(entry.key)}">
  <td class="key-cell">${this._esc(entry.key)}${
    entry.is_current ? '<span class="badge">current</span>' : ""
  }</td>
  <td><span class="source-chip">${this._esc(entry.source_name)}</span></td>
  <td class="enum-cell">
    ${
      editing
        ? `<input class="enum-input" type="number" min="0" max="9"
                  value="${entry.enum}"
                  data-entry-id="${this._esc(entry.entry_id)}"
                  data-key="${this._esc(entry.key)}" />`
        : `<span class="enum-display${entry.enum === 0 ? " zero" : ""}"
                  data-action="edit"
                  data-entry-id="${this._esc(entry.entry_id)}"
                  data-key="${this._esc(entry.key)}"
                  title="Click to edit">${entry.enum}</span>`
    }
  </td>
  <td>${this._relTime(entry.last_seen)}</td>
</tr>`;
  }

  _paginationHtml(page, totalPages) {
    const MAX_BTNS = 10;
    let start = Math.max(1, page - Math.floor(MAX_BTNS / 2));
    const end = Math.min(totalPages, start + MAX_BTNS - 1);
    if (end - start < MAX_BTNS - 1) start = Math.max(1, end - MAX_BTNS + 1);

    const btns = [];
    if (start > 1) btns.push(`<button class="ghost page-btn" data-page="1">1</button><span>…</span>`);
    for (let p = start; p <= end; p++) {
      btns.push(
        `<button class="${p === page ? "active" : "ghost"} page-btn" data-page="${p}">${p}</button>`
      );
    }
    if (end < totalPages) btns.push(`<span>…</span><button class="ghost page-btn" data-page="${totalPages}">${totalPages}</button>`);

    return `
<div class="pagination">
  <button class="ghost" id="pg-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
  ${btns.join("")}
  <button class="ghost" id="pg-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
</div>`;
  }

  // ----------------------------------------------------------- event wiring --

  _attachEvents(page, totalPages) {
    const root = this.shadowRoot;

    // Filter: Apply button
    root.querySelector("#btn-apply")?.addEventListener("click", () => {
      this._filterSource = root.querySelector("#f-source")?.value ?? "";
      this._filterUnclassified = root.querySelector("#f-unclassified")?.checked ?? false;
      this._filterSearch = root.querySelector("#f-search")?.value ?? "";
      this._loadEntries();
    });

    // Enter in search box = Apply
    root.querySelector("#f-search")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") root.querySelector("#btn-apply")?.click();
    });

    // Refresh button
    root.querySelector("#btn-refresh")?.addEventListener("click", () => this._loadEntries());

    // Sort headers
    root.querySelector("#th-key")?.addEventListener("click", () => this._toggleSort("key"));
    root.querySelector("#th-enum")?.addEventListener("click", () => this._toggleSort("enum"));
    root.querySelector("#th-last-seen")?.addEventListener("click", () => this._toggleSort("last_seen"));

    // Click on enum display → enter edit mode
    root.querySelectorAll('[data-action="edit"]').forEach((el) => {
      el.addEventListener("click", () => {
        this._editingKey = this._editKey(el.dataset.entryId, el.dataset.key);
        this._render();
      });
    });

    // Inline input events
    root.querySelectorAll(".enum-input").forEach((input) => {
      // Live validation feedback
      input.addEventListener("input", () => {
        const v = parseInt(input.value, 10);
        input.classList.toggle("invalid", isNaN(v) || v < 0 || v > 9);
      });

      // Enter → blur (blur handler does the save, preventing double-call)
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { this._editingKey = null; this._render(); }
      });

      // Blur → save if we're still in edit mode for this row
      input.addEventListener("blur", async () => {
        const ek = this._editKey(input.dataset.entryId, input.dataset.key);
        if (this._editingKey === ek) {
          await this._updateEntry(input.dataset.entryId, input.dataset.key, input.value);
        }
      });
    });

    // Pagination
    root.querySelectorAll(".page-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._page = parseInt(btn.dataset.page, 10);
        this._render();
      });
    });
    root.querySelector("#pg-prev")?.addEventListener("click", () => {
      if (this._page > 1) { this._page--; this._render(); }
    });
    root.querySelector("#pg-next")?.addEventListener("click", () => {
      if (this._page < totalPages) { this._page++; this._render(); }
    });
  }

  // ----------------------------------------------------------------- utils --

  _editKey(entryId, key) {
    return `${entryId}::${key}`;
  }

  _toast(message, type = "info") {
    const root = this.shadowRoot;
    root.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  _relTime(iso) {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return iso;
    const s = Math.floor(Math.abs(diff) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  _esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

customElements.define("etm-panel", EtmPanel);
