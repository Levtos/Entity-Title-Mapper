// Entity Title Mapper – Title Classifier panel
// ─── Edit these to match your automation categories ───────────────────────
// Index = enum value (0–9). 0 is always "unclassified".
const ENUM_LABELS = ["?",  "1",  "2",  "3",  "4",  "5",  "6",  "7",  "8",  "9"];
const ENUM_COLORS = [
  "#78909c",  // 0  unclassified (grey)
  "#4caf50",  // 1  green
  "#2196f3",  // 2  blue
  "#ff9800",  // 3  amber
  "#9c27b0",  // 4  purple
  "#f44336",  // 5  red
  "#00bcd4",  // 6  cyan
  "#8bc34a",  // 7  light green
  "#ff5722",  // 8  deep orange
  "#607d8b",  // 9  steel blue
];
// ─────────────────────────────────────────────────────────────────────────

class EtmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass   = null;
    this._sources = [];
    this._entries = [];
    this._loading = false;
    this._saving  = false;

    this._filterSource       = "";
    this._filterUnclassified = false;
    this._filterSearch       = "";

    this._sortBy  = "last_seen";
    this._sortAsc = false;
    this._page    = 1;
    this._pageSize = 100;

    // "entry_id::key" of the row whose chip-picker is currently open
    this._editingKey = null;
    // Persistent handlers so we can remove them cleanly
    this._outsideClickHandler = null;
    this._escHandler          = null;
    this._refreshTimer        = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loading && this._sources.length === 0) this._initialLoad();
  }

  connectedCallback() {
    this._render();
    this._refreshTimer = setInterval(() => this._loadEntries(), 30_000);
  }

  disconnectedCallback() {
    clearInterval(this._refreshTimer);
    this._removePermanentHandlers();
  }

  // ── data ─────────────────────────────────────────────────────────────────

  async _initialLoad() {
    await Promise.all([this._loadSources(), this._loadEntries()]);
  }

  async _loadSources() {
    if (!this._hass) return;
    try {
      this._sources = await this._hass.connection.sendMessagePromise({ type: "etm/get_sources" });
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
      if (this._filterSource)        msg.source       = this._filterSource;
      if (this._filterUnclassified)  msg.unclassified = true;
      if (this._filterSearch.trim()) msg.search       = this._filterSearch.trim();
      this._entries = await this._hass.connection.sendMessagePromise(msg);
      this._page = 1;
    } catch (err) {
      this._toast(`Failed to load entries: ${err.message}`, "error");
    } finally {
      this._loading = false;
      this._render();
    }
  }

  async _updateEntry(entryId, key, value) {
    if (this._saving) return;
    this._saving = true;
    this._closePicker(); // optimistic: close picker immediately
    try {
      await this._hass.connection.sendMessagePromise({
        type:       "etm/update_entry",
        entry_id:   entryId,
        key,
        enum_value: value,
      });
      const entry = this._entries.find(e => e.entry_id === entryId && e.key === key);
      if (entry) entry.enum = value;
      this._toast("Saved", "success");
    } catch (err) {
      this._toast(`Save failed: ${err.message}`, "error");
    } finally {
      this._saving = false;
      this._render();
    }
  }

  // ── picker lifecycle ──────────────────────────────────────────────────────

  _openPicker(ek) {
    this._editingKey = ek;

    // Close on Escape
    this._escHandler = (e) => { if (e.key === "Escape") this._closePicker(); };
    window.addEventListener("keydown", this._escHandler);

    // Close when clicking outside the open enum cell (capture phase so it
    // fires before internal handlers; stopPropagation on chip clicks prevents
    // false positives)
    this._outsideClickHandler = (e) => {
      if (!e.target.closest(".enum-cell.open")) this._closePicker();
    };
    this.shadowRoot.addEventListener("click", this._outsideClickHandler, { capture: true });

    this._render();
  }

  _closePicker() {
    this._editingKey = null;
    if (this._escHandler) {
      window.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
    if (this._outsideClickHandler) {
      this.shadowRoot.removeEventListener("click", this._outsideClickHandler, { capture: true });
      this._outsideClickHandler = null;
    }
    this._render();
  }

  _removePermanentHandlers() {
    if (this._escHandler) window.removeEventListener("keydown", this._escHandler);
    if (this._outsideClickHandler)
      this.shadowRoot?.removeEventListener("click", this._outsideClickHandler, { capture: true });
  }

  // ── sorting ───────────────────────────────────────────────────────────────

  _sortedEntries() {
    return [...this._entries].sort((a, b) => {
      let cmp;
      switch (this._sortBy) {
        case "key":  cmp = a.key.localeCompare(b.key); break;
        case "enum": cmp = a.enum - b.enum; break;
        default:     cmp = new Date(a.last_seen) - new Date(b.last_seen);
      }
      return this._sortAsc ? cmp : -cmp;
    });
  }

  _toggleSort(col) {
    if (this._sortBy === col) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortBy  = col;
      this._sortAsc = col !== "last_seen"; // last_seen defaults desc (newest first)
    }
    this._render();
  }

  // ── render ────────────────────────────────────────────────────────────────

  _render() {
    if (!this.shadowRoot) return;
    const sorted     = this._sortedEntries();
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
    const page       = Math.min(this._page, totalPages);
    const pageRows   = sorted.slice((page - 1) * this._pageSize, page * this._pageSize);

    const arrow = (col) =>
      this._sortBy !== col
        ? `<span class="sort-hint">↕</span>`
        : this._sortAsc
          ? `<span class="sort-active">↑</span>`
          : `<span class="sort-active">↓</span>`;

    this.shadowRoot.innerHTML = `
<style>
  :host {
    display: block; padding: 24px;
    color: var(--primary-text-color);
    background: var(--primary-background-color);
    min-height: 100%; box-sizing: border-box;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
  }
  h1 { margin: 0 0 20px; font-size: 1.5rem; font-weight: 400; }

  /* ── toolbar ── */
  .toolbar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    margin-bottom: 16px; padding: 12px 16px;
    background: var(--card-background-color); border-radius: 8px;
    box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
  }
  .filter-group { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  select, input[type="text"] {
    background: var(--input-fill-color, var(--secondary-background-color));
    border: 1px solid var(--input-ink-color, var(--secondary-text-color));
    border-radius: 4px; color: var(--primary-text-color);
    font: inherit; height: 34px; padding: 0 10px;
  }
  select { min-width: 130px; }
  input[type="text"] { min-width: 190px; }
  input[type="checkbox"] { cursor: pointer; }
  .btn {
    border: none; border-radius: 4px; cursor: pointer; font: inherit;
    height: 34px; padding: 0 14px; transition: opacity .15s;
  }
  .btn-primary { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn-ghost   { background: transparent; border: 1px solid var(--divider-color); color: var(--primary-text-color); }
  .btn:hover   { opacity: .85; }

  /* ── table ── */
  .results-info { margin-bottom: 8px; font-size: .85rem; color: var(--secondary-text-color); }
  .table-wrap {
    background: var(--card-background-color); border-radius: 8px;
    box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
    overflow-x: auto; transition: opacity .2s;
  }
  .table-wrap.loading { opacity: .5; pointer-events: none; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  thead th {
    background: var(--table-header-background-color, var(--secondary-background-color));
    border-bottom: 2px solid var(--divider-color);
    cursor: pointer; font-weight: 600; padding: 11px 16px;
    text-align: left; user-select: none; white-space: nowrap;
  }
  thead th:hover { filter: brightness(.95); }
  .sort-hint   { opacity: .35; }
  .sort-active { color: var(--primary-color); }
  td {
    border-bottom: 1px solid var(--divider-color);
    padding: 10px 16px; vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  tr.unmapped td:first-child  { border-left: 3px solid var(--warning-color, #ffa600); }
  tr.is-current { background: color-mix(in srgb, var(--primary-color) 7%, transparent); }

  .key-cell {
    font-family: var(--code-font-family, monospace); font-size: .9rem;
    max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .badge {
    background: var(--primary-color); border-radius: 999px; color: #fff;
    display: inline-block; font-size: .72rem; margin-left: 6px; padding: 1px 7px;
    vertical-align: middle;
  }
  .source-chip {
    background: var(--secondary-background-color); border-radius: 4px;
    font-size: .82rem; padding: 2px 8px; white-space: nowrap;
  }

  /* ── chips ── */
  .enum-cell     { min-width: 52px; }
  .enum-cell.open { min-width: 220px; }

  .chip {
    background: var(--chip-bg);
    border: none; border-radius: 999px; color: #fff; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    font: 700 .8rem/1 inherit;
    height: 28px; min-width: 28px; padding: 0 10px;
    text-shadow: 0 1px 2px rgba(0,0,0,.2);
    transition: transform .1s, filter .1s;
    vertical-align: middle;
  }
  .chip:hover  { transform: scale(1.12); filter: brightness(1.1); }
  .chip.zero   { opacity: .65; }
  .chip.active-chip { box-shadow: 0 0 0 2px var(--primary-background-color), 0 0 0 4px var(--primary-text-color); }

  .chip-picker {
    display: flex; flex-wrap: wrap; gap: 5px;
    margin-top: 8px; padding: 8px;
    background: var(--secondary-background-color);
    border-radius: 8px; border: 1px solid var(--divider-color);
  }
  .picker-chip { padding: 0 8px; min-width: 28px; }

  /* ── pagination ── */
  .pagination {
    display: flex; align-items: center; justify-content: center;
    flex-wrap: wrap; gap: 6px; margin-top: 14px;
  }
  .pagination .btn { min-width: 36px; padding: 0 8px; }
  .pagination .btn.active { background: var(--primary-color); color: var(--text-primary-color, #fff); }

  .empty { color: var(--secondary-text-color); padding: 40px; text-align: center; }

  /* ── toast ── */
  .toast {
    animation: toast-in .2s ease; border-radius: 8px;
    bottom: 28px; box-shadow: 0 4px 14px rgba(0,0,0,.25); color: #fff;
    font-size: .9rem; max-width: 320px; padding: 12px 20px;
    position: fixed; right: 28px; z-index: 9999;
    background: var(--primary-color);
  }
  .toast.error   { background: var(--error-color,   #f44336); }
  .toast.success { background: var(--success-color, #4caf50); }
  @keyframes toast-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
</style>

<h1>Title Classifier</h1>

<div class="toolbar">
  <div class="filter-group">
    Source
    <select id="f-source">
      <option value="">All</option>
      ${this._sources.map(s =>
        `<option value="${this._esc(s.entry_id)}"${this._filterSource === s.entry_id ? " selected" : ""}>${this._esc(s.name)}</option>`
      ).join("")}
    </select>
  </div>
  <div class="filter-group">
    <input type="checkbox" id="f-unclass"${this._filterUnclassified ? " checked" : ""} />
    <label for="f-unclass">Unclassified only</label>
  </div>
  <div class="filter-group">
    <input type="text" id="f-search" placeholder="Search titles…" value="${this._esc(this._filterSearch)}" />
  </div>
  <button class="btn btn-primary" id="btn-apply">Apply</button>
  <button class="btn btn-ghost"   id="btn-refresh">↻ Refresh</button>
</div>

<div class="results-info">
  ${this._loading
    ? "Loading…"
    : `${sorted.length} entr${sorted.length === 1 ? "y" : "ies"}${totalPages > 1 ? ` · page ${page}/${totalPages}` : ""}`}
</div>

<div class="table-wrap${this._loading ? " loading" : ""}">
  <table>
    <thead>
      <tr>
        <th id="th-key">Title ${arrow("key")}</th>
        <th>Source</th>
        <th id="th-enum">Value ${arrow("enum")}</th>
        <th id="th-last">Last Seen ${arrow("last_seen")}</th>
      </tr>
    </thead>
    <tbody>
      ${pageRows.length === 0
        ? `<tr><td class="empty" colspan="4">${this._loading ? "Loading…" : "No entries found."}</td></tr>`
        : pageRows.map(e => this._rowHtml(e)).join("")}
    </tbody>
  </table>
</div>

${totalPages > 1 ? this._paginationHtml(page, totalPages) : ""}
`;

    this._attachEvents(page, totalPages);
  }

  _rowHtml(entry) {
    const ek      = this._editKey(entry.entry_id, entry.key);
    const editing = this._editingKey === ek;
    const cls = [
      entry.enum === 0 ? "unmapped"   : "",
      entry.is_current  ? "is-current" : "",
    ].filter(Boolean).join(" ");

    return `
<tr class="${cls}">
  <td class="key-cell">
    ${this._esc(entry.key)}${entry.is_current ? '<span class="badge">current</span>' : ""}
  </td>
  <td><span class="source-chip">${this._esc(entry.source_name)}</span></td>
  <td class="enum-cell${editing ? " open" : ""}">
    ${this._chipCellHtml(entry.enum, entry.entry_id, entry.key, editing)}
  </td>
  <td>${this._relTime(entry.last_seen)}</td>
</tr>`;
  }

  _chipCellHtml(enumVal, entryId, key, open) {
    const label = ENUM_LABELS[enumVal] ?? String(enumVal);
    const color = ENUM_COLORS[enumVal] ?? "#888";

    // The "handle" chip — always visible; click toggles the picker
    const handle = `
      <button class="chip${enumVal === 0 ? " zero" : ""}${open ? " active-chip" : ""}"
              style="--chip-bg:${color}"
              data-action="toggle-picker"
              data-entry-id="${this._esc(entryId)}"
              data-key="${this._esc(key)}"
              title="${open ? "Close (Esc)" : "Click to classify"}">${label}</button>`;

    if (!open) return handle;

    // Picker: all 10 enum values as chips
    const pickerChips = Array.from({ length: 10 }, (_, i) => {
      const l = ENUM_LABELS[i] ?? String(i);
      const c = ENUM_COLORS[i] ?? "#888";
      return `
        <button class="chip picker-chip${i === enumVal ? " active-chip" : ""}"
                style="--chip-bg:${c}"
                data-action="pick-enum"
                data-value="${i}"
                data-entry-id="${this._esc(entryId)}"
                data-key="${this._esc(key)}"
                title="Set to ${i}">${l}</button>`;
    }).join("");

    return `${handle}<div class="chip-picker">${pickerChips}</div>`;
  }

  _paginationHtml(page, totalPages) {
    const MAX_BTNS = 10;
    let start = Math.max(1, page - Math.floor(MAX_BTNS / 2));
    const end = Math.min(totalPages, start + MAX_BTNS - 1);
    if (end - start < MAX_BTNS - 1) start = Math.max(1, end - MAX_BTNS + 1);

    const btns = [];
    if (start > 1) btns.push(`<button class="btn btn-ghost page-btn" data-page="1">1</button><span>…</span>`);
    for (let p = start; p <= end; p++) {
      btns.push(`<button class="btn ${p === page ? "active" : "btn-ghost"} page-btn" data-page="${p}">${p}</button>`);
    }
    if (end < totalPages) btns.push(`<span>…</span><button class="btn btn-ghost page-btn" data-page="${totalPages}">${totalPages}</button>`);

    return `
<div class="pagination">
  <button class="btn btn-ghost" id="pg-prev" ${page <= 1 ? "disabled" : ""}>← Prev</button>
  ${btns.join("")}
  <button class="btn btn-ghost" id="pg-next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
</div>`;
  }

  // ── event wiring ─────────────────────────────────────────────────────────

  _attachEvents(page, totalPages) {
    const root = this.shadowRoot;

    root.querySelector("#btn-apply")?.addEventListener("click", () => {
      this._filterSource       = root.querySelector("#f-source")?.value ?? "";
      this._filterUnclassified = root.querySelector("#f-unclass")?.checked ?? false;
      this._filterSearch       = root.querySelector("#f-search")?.value ?? "";
      this._loadEntries();
    });

    root.querySelector("#f-search")?.addEventListener("keydown", e => {
      if (e.key === "Enter") root.querySelector("#btn-apply")?.click();
    });

    root.querySelector("#btn-refresh")?.addEventListener("click", () => this._loadEntries());

    // Sortable headers
    root.querySelector("#th-key")?.addEventListener("click",  () => this._toggleSort("key"));
    root.querySelector("#th-enum")?.addEventListener("click", () => this._toggleSort("enum"));
    root.querySelector("#th-last")?.addEventListener("click", () => this._toggleSort("last_seen"));

    // Toggle chip: open / close picker
    root.querySelectorAll('[data-action="toggle-picker"]').forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation(); // prevent _outsideClickHandler from firing
        const ek = this._editKey(btn.dataset.entryId, btn.dataset.key);
        if (this._editingKey === ek) {
          this._closePicker();
        } else {
          // Close any currently open picker first, then open the new one.
          // Avoid double-render: clear state without calling _closePicker (which renders).
          this._editingKey = null;
          if (this._outsideClickHandler) {
            this.shadowRoot.removeEventListener("click", this._outsideClickHandler, { capture: true });
            this._outsideClickHandler = null;
          }
          if (this._escHandler) {
            window.removeEventListener("keydown", this._escHandler);
            this._escHandler = null;
          }
          this._openPicker(ek);
        }
      });
    });

    // Picker chip: select an enum value immediately
    root.querySelectorAll('[data-action="pick-enum"]').forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation(); // prevent _outsideClickHandler from firing
        this._updateEntry(btn.dataset.entryId, btn.dataset.key, Number(btn.dataset.value));
      });
    });

    // Pagination
    root.querySelectorAll(".page-btn").forEach(btn => {
      btn.addEventListener("click", () => { this._page = parseInt(btn.dataset.page, 10); this._render(); });
    });
    root.querySelector("#pg-prev")?.addEventListener("click", () => {
      if (this._page > 1) { this._page--; this._render(); }
    });
    root.querySelector("#pg-next")?.addEventListener("click", () => {
      if (this._page < totalPages) { this._page++; this._render(); }
    });
  }

  // ── utilities ─────────────────────────────────────────────────────────────

  _editKey(entryId, key) { return `${entryId}::${key}`; }

  _toast(message, type = "info") {
    this.shadowRoot?.querySelectorAll(".toast").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    this.shadowRoot.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  _relTime(iso) {
    if (!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return iso;
    const s = Math.floor(Math.abs(diff) / 1000);
    if (s < 60)  return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  _esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}

customElements.define("etm-panel", EtmPanel);
