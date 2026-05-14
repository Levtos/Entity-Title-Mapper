// Title Classifier panel
// Uses Home Assistant WebSocket commands for authenticated ETM access.
// Number inputs are always visible; change + blur/Enter saves immediately.

class EtmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass    = null;
    this._sources = [];
    this._entries = [];
    this._loading = false;
    this._timer   = null;

    this._filterSource       = "";
    this._filterUnclassified = false;
    this._filterSearch       = "";

    this._sortBy  = "last_seen";
    this._sortAsc = false;   // newest first by default

    this._page     = 1;
    this._pageSize = 100;

    this._groupByArtist = false;
    this._showLegend    = false;

    this._lastRenderSignature = null;
  }

  set hass(h) {
    this._hass = h;
    if (!this._loading && this._entries.length === 0) this._load();
  }

  connectedCallback() {
    this._render();
    this._timer = setInterval(() => this._loadEntries(), 30_000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  // ── WebSocket helper ──────────────────────────────────────────────────────

  async _ws(message) {
    if (!this._hass?.connection) throw new Error("Home Assistant connection unavailable");
    return this._hass.connection.sendMessagePromise(message);
  }

  // ── data loading ──────────────────────────────────────────────────────────

  async _load() {
    await Promise.all([this._loadSources(), this._loadEntries()]);
  }

  async _loadSources() {
    try {
      this._sources = await this._ws({ type: "etm/get_sources" });
    } catch (err) {
      this._toast(`Quellen konnten nicht geladen werden: ${err.message}`, "error");
    }
    this._render();
  }

  async _loadEntries({ showLoading = false, resetPage = false } = {}) {
    if (!this._hass) return;
    this._loading = showLoading;
    this._setTableLoading(showLoading);
    try {
      const message = { type: "etm/list_entries" };
      if (this._filterSource) message.source = this._filterSource;
      if (this._filterUnclassified) message.unclassified = true;
      if (this._filterSearch.trim()) message.search = this._filterSearch.trim();
      this._entries = await this._ws(message);
      if (resetPage) this._page = 1;
    } catch (err) {
      this._toast(`Laden fehlgeschlagen: ${err.message}`, "error");
    } finally {
      this._loading = false;
      this._setTableLoading(false);
      this._render();
    }
  }

  _setTableLoading(isLoading) {
    this.shadowRoot?.querySelector(".tw")?.classList.toggle("loading", isLoading);
  }

  // ── save — no full re-render, just update the input's baseline ────────────

  async _save(entryId, key, value, inputEl) {
    try {
      await this._ws({ type: "etm/update_entry", entry_id: entryId, key, enum_value: value });
      const e = this._entries.find(e => e.entry_id === entryId && e.key === key);
      if (e) e.enum = value;
      inputEl.dataset.original = String(value);
      this._flash(inputEl, "saved");
    } catch (err) {
      this._toast(`Speichern fehlgeschlagen: ${err.message}`, "error");
      inputEl.value = inputEl.dataset.original;
      this._flash(inputEl, "err");
    }
  }

  _flash(el, cls) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }

  // ── sorting ───────────────────────────────────────────────────────────────

  _sorted() {
    const grouping = this._groupByArtist && this._isMediaSource();
    return [...this._entries].sort((a, b) => {
      if (grouping) {
        const ac = (this._artistFrom(a.key) ?? "").localeCompare(this._artistFrom(b.key) ?? "");
        if (ac !== 0) return ac;
      }
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
      this._sortAsc = col !== "last_seen";
    }
    this._render();
  }

  // ── artist helpers ────────────────────────────────────────────────────────

  _artistFrom(key) {
    const i = key.indexOf(" - ");
    return i >= 0 ? key.slice(0, i) : null;
  }

  _titleFrom(key) {
    const i = key.indexOf(" - ");
    return i >= 0 ? key.slice(i + 3) : key;
  }

  _isMediaSource() {
    if (this._filterSource) {
      const src = this._sources.find(s => s.entry_id === this._filterSource);
      return src?.watcher_type === "media";
    }
    return this._sources.some(s => s.watcher_type === "media");
  }

  // ── render ────────────────────────────────────────────────────────────────

  _render(force = false) {
    if (!this.shadowRoot) return;

    const sorted     = this._sorted();
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
    const page       = Math.min(this._page, totalPages);
    if (this._page !== page) this._page = page;
    const rows      = sorted.slice((page - 1) * this._pageSize, page * this._pageSize);
    const signature = this._renderSignature(page);
    if (!force && signature === this._lastRenderSignature) return;
    this._lastRenderSignature = signature;

    const arr = col =>
      this._sortBy !== col
        ? `<span class="sh">↕</span>`
        : `<span class="sa">${this._sortAsc ? "↑" : "↓"}</span>`;

    const showGroupBy = this._isMediaSource();

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

/* toolbar */
.bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin-bottom: 14px; padding: 12px 16px;
  background: var(--card-background-color); border-radius: 8px;
  box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
}
.fg { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
select, input[type="text"] {
  background: var(--input-fill-color, var(--secondary-background-color));
  border: 1px solid var(--input-ink-color, var(--secondary-text-color));
  border-radius: 4px; color: var(--primary-text-color);
  font: inherit; height: 34px; padding: 0 10px;
}
select             { min-width: 130px; }
input[type="text"] { min-width: 180px; }
input[type="checkbox"] { cursor: pointer; }
.btn {
  border: none; border-radius: 4px; cursor: pointer;
  font: inherit; height: 34px; padding: 0 14px; transition: opacity .15s;
}
.btn-p { background: var(--primary-color); color: var(--text-primary-color, #fff); }
.btn-g {
  background: transparent;
  border: 1px solid var(--divider-color);
  color: var(--primary-text-color);
}
.btn:hover { opacity: .85; }

/* legend */
.legend {
  display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 14px;
}
.leg-section {
  background: var(--card-background-color); border-radius: 8px;
  box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
  flex: 1; min-width: 260px; padding: 14px 16px;
}
.leg-title {
  font-size: .85rem; font-weight: 600; letter-spacing: .04em;
  margin-bottom: 10px; text-transform: uppercase;
  color: var(--secondary-text-color);
}
.leg-table { border-collapse: collapse; font-size: .88rem; width: 100%; }
.leg-table th {
  border-bottom: 1px solid var(--divider-color);
  font-weight: 600; padding: 4px 10px 6px; text-align: left;
}
.leg-table td { padding: 5px 10px; border-bottom: 1px solid var(--divider-color); }
.leg-table tr:last-child td { border-bottom: none; }
.leg-enum { font-family: var(--code-font-family, monospace); font-weight: 700; width: 46px; }
.leg-mode { color: var(--secondary-text-color); font-family: var(--code-font-family, monospace); font-size: .82rem; }
.leg-reserviert td { color: var(--secondary-text-color); font-style: italic; }

/* info line */
.inf { margin-bottom: 8px; font-size: .85rem; color: var(--secondary-text-color); }

/* table card */
.tw {
  background: var(--card-background-color); border-radius: 8px;
  box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.12));
  overflow-x: auto; transition: opacity .2s;
}
.tw.loading { opacity: .5; pointer-events: none; }
table { border-collapse: collapse; width: 100%; font-size: .94rem; }
thead th {
  background: var(--table-header-background-color, var(--secondary-background-color));
  border-bottom: 2px solid var(--divider-color);
  cursor: pointer; font-weight: 600; padding: 11px 16px;
  text-align: left; user-select: none; white-space: nowrap;
}
thead th:hover { filter: brightness(.95); }
.sh { opacity: .3; }
.sa { color: var(--primary-color); }
td  { border-bottom: 1px solid var(--divider-color); padding: 8px 16px; vertical-align: middle; }
tr:last-child td { border-bottom: none; }

/* artist group header row */
tr.artist-hdr td {
  background: var(--secondary-background-color);
  border-bottom: 1px solid var(--divider-color);
  border-left: 3px solid var(--primary-color);
  color: var(--primary-text-color);
  font-size: .85rem; font-weight: 600; padding: 6px 16px;
}

/* row accents */
tr.zero    td:first-child { border-left: 3px solid var(--warning-color, #ffa600); }
tr.current { background: color-mix(in srgb, var(--primary-color) 7%, transparent); }

/* cells */
.key {
  font-family: var(--code-font-family, monospace); font-size: .88rem;
  max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.badge {
  background: var(--primary-color); border-radius: 999px; color: #fff;
  font-size: .7rem; margin-left: 6px; padding: 1px 7px; vertical-align: middle;
}
.src {
  background: var(--secondary-background-color);
  border-radius: 4px; font-size: .8rem; padding: 2px 8px; white-space: nowrap;
}

/* always-visible number input for enum */
.ei {
  background: var(--input-fill-color, var(--secondary-background-color));
  border: 1px solid var(--divider-color);
  border-radius: 4px; color: var(--primary-text-color);
  font: 600 1rem/1 inherit; text-align: center;
  width: 62px; height: 30px; padding: 0;
  transition: border-color .18s, background .18s;
}
.ei:focus { outline: none; border-color: var(--primary-color); }
.ei.saved {
  border-color: var(--success-color, #4caf50);
  background: color-mix(in srgb, var(--success-color, #4caf50) 14%, transparent);
}
.ei.err {
  border-color: var(--error-color, #f44336);
  background: color-mix(in srgb, var(--error-color, #f44336) 14%, transparent);
}

/* pagination */
.pag {
  display: flex; align-items: center; justify-content: center;
  flex-wrap: wrap; gap: 6px; margin-top: 14px;
}
.pag .btn { min-width: 36px; padding: 0 8px; }
.pag .act { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }

/* empty state */
.empty { color: var(--secondary-text-color); padding: 40px; text-align: center; }

/* toast */
.toast {
  animation: tin .2s ease; border-radius: 8px;
  bottom: 28px; box-shadow: 0 4px 14px rgba(0,0,0,.25);
  color: #fff; font-size: .9rem; max-width: 320px;
  padding: 12px 20px; position: fixed; right: 28px; z-index: 9999;
  background: var(--primary-color);
}
.toast.error   { background: var(--error-color,   #f44336); }
.toast.success { background: var(--success-color, #4caf50); }
@keyframes tin { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
</style>

<h1>Title Classifier</h1>

<div class="bar">
  <div class="fg">
    Source
    <select id="f-src">
      <option value="">Alle</option>
      ${this._sources.map(s =>
        `<option value="${this._esc(s.entry_id)}"${this._filterSource === s.entry_id ? " selected" : ""}>${this._esc(s.name)}</option>`
      ).join("")}
    </select>
  </div>
  <div class="fg">
    <input type="checkbox" id="f-unc"${this._filterUnclassified ? " checked" : ""} />
    <label for="f-unc">Nur unklassifiziert</label>
  </div>
  <div class="fg">
    <input type="text" id="f-s" placeholder="Titel suchen …" value="${this._esc(this._filterSearch)}" />
  </div>
  <button class="btn btn-p" id="btn-apply">Übernehmen</button>
  <button class="btn btn-g" id="btn-ref" title="Jetzt aktualisieren">↻</button>
  ${showGroupBy ? `
  <div class="fg">
    <input type="checkbox" id="f-grp"${this._groupByArtist ? " checked" : ""} />
    <label for="f-grp">Nach Künstler</label>
  </div>` : ""}
  <button class="btn btn-g" id="btn-leg">${this._showLegend ? "Legende ▴" : "Legende ▾"}</button>
</div>

${this._showLegend ? this._legendHtml() : ""}

<div class="inf">
  ${this._loading
    ? "Lädt …"
    : `${sorted.length} Eintr${sorted.length === 1 ? "ag" : "äge"}${totalPages > 1 ? ` · Seite ${page}/${totalPages}` : ""}`}
</div>

<div class="tw${this._loading ? " loading" : ""}">
  <table>
    <thead>
      <tr>
        <th id="th-k">Titel ${arr("key")}</th>
        <th>Source</th>
        <th id="th-e" style="width:90px">Wert ${arr("enum")}</th>
        <th id="th-l">Zuletzt ${arr("last_seen")}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.length === 0
        ? `<tr><td class="empty" colspan="4">${this._loading ? "Lädt …" : "Keine Einträge gefunden."}</td></tr>`
        : this._renderRows(rows)}
    </tbody>
  </table>
</div>

${totalPages > 1 ? this._pagHtml(page, totalPages) : ""}
`;

    this._wire(page, totalPages);
  }

  // ── row rendering ─────────────────────────────────────────────────────────

  _renderRows(rows) {
    if (!this._groupByArtist || !this._isMediaSource()) {
      return rows.map(e => this._rowHtml(e, e.key)).join("");
    }

    const groups = new Map();
    for (const e of rows) {
      const artist = this._artistFrom(e.key) ?? "— Kein Künstler —";
      if (!groups.has(artist)) groups.set(artist, []);
      groups.get(artist).push(e);
    }

    let html = "";
    for (const [artist, entries] of groups) {
      html += `<tr class="artist-hdr"><td colspan="4">${this._esc(artist)}</td></tr>`;
      html += entries.map(e => this._rowHtml(e, this._titleFrom(e.key))).join("");
    }
    return html;
  }

  _rowHtml(e, displayKey) {
    return `<tr class="${e.enum === 0 ? "zero" : ""}${e.is_current ? " current" : ""}">
  <td class="key">${this._esc(displayKey)}${e.is_current ? '<span class="badge">aktiv</span>' : ""}</td>
  <td><span class="src">${this._esc(e.source_name)}</span></td>
  <td>
    <input class="ei" type="number" min="0" max="9" step="1"
           value="${e.enum}" data-original="${e.enum}"
           data-eid="${this._esc(e.entry_id)}" data-key="${this._esc(e.key)}" />
  </td>
  <td>${this._rel(e.last_seen)}</td>
</tr>`;
  }

  // ── legend ────────────────────────────────────────────────────────────────

  _legendHtml() {
    const MEDIA = [
      [0,     "normal",         "Kein besonderer Eingriff"],
      [1,     "boost",          "Lieblingstitel → Track Boost +0.15"],
      [2,     "mute",           "Unerwünschter Titel → Lautstärke 0"],
      ["3–9", "Reserviert",     "Zukünftige Erweiterungen"],
    ];
    const GAME = [
      [0,     "gaming_default", "Unklassifiziert, Standard-Routing"],
      [1,     "gaming_grind",   "Grinding-Modus, Musik dominant"],
      [2,     "gaming_headset", "Headset-Modus, immersives Spiel"],
      ["3–9", "Reserviert",     "Zukünftige Erweiterungen"],
    ];

    const selectedSrc = this._sources.find(s => s.entry_id === this._filterSource);
    const types = new Set(
      selectedSrc ? [selectedSrc.watcher_type] : this._sources.map(s => s.watcher_type)
    );

    const table = (legend, title) => `
<div class="leg-section">
  <div class="leg-title">${title}</div>
  <table class="leg-table">
    <thead><tr><th>Enum</th><th>Modus</th><th>Bedeutung</th></tr></thead>
    <tbody>
      ${legend.map(([e, m, d]) =>
        `<tr${typeof e === "string" ? ' class="leg-reserviert"' : ""}>`
        + `<td class="leg-enum">${e}</td>`
        + `<td class="leg-mode">${this._esc(m)}</td>`
        + `<td>${this._esc(d)}</td></tr>`
      ).join("")}
    </tbody>
  </table>
</div>`;

    const sections = [];
    if (types.has("media") || types.has("activity")) sections.push(table(MEDIA, "Media"));
    if (types.has("game"))                            sections.push(table(GAME,  "Game / Gaming"));

    return sections.length ? `<div class="legend">${sections.join("")}</div>` : "";
  }

  _pagHtml(page, n) {
    const MAX = 9;
    let s = Math.max(1, page - Math.floor(MAX / 2));
    const e = Math.min(n, s + MAX - 1);
    if (e - s < MAX - 1) s = Math.max(1, e - MAX + 1);
    const btns = [];
    if (s > 1) btns.push(`<button class="btn btn-g pb" data-p="1">1</button><span>…</span>`);
    for (let p = s; p <= e; p++)
      btns.push(`<button class="btn btn-g${p === page ? " act" : ""} pb" data-p="${p}">${p}</button>`);
    if (e < n) btns.push(`<span>…</span><button class="btn btn-g pb" data-p="${n}">${n}</button>`);
    return `
<div class="pag">
  <button class="btn btn-g" id="pg-p" ${page <= 1 ? "disabled" : ""}>← Zurück</button>
  ${btns.join("")}
  <button class="btn btn-g" id="pg-n" ${page >= n ? "disabled" : ""}>Weiter →</button>
</div>`;
  }

  // ── event wiring ──────────────────────────────────────────────────────────

  _wire(page, totalPages) {
    const r = this.shadowRoot;

    // filter bar
    r.querySelector("#btn-apply")?.addEventListener("click", () => {
      this._filterSource       = r.querySelector("#f-src")?.value ?? "";
      this._filterUnclassified = r.querySelector("#f-unc")?.checked ?? false;
      this._filterSearch       = r.querySelector("#f-s")?.value ?? "";
      this._loadEntries({ resetPage: true });
    });
    r.querySelector("#f-s")?.addEventListener("keydown", ev => {
      if (ev.key === "Enter") r.querySelector("#btn-apply")?.click();
    });
    r.querySelector("#btn-ref")?.addEventListener("click", () => this._loadEntries({ showLoading: true }));

    // legend toggle
    r.querySelector("#btn-leg")?.addEventListener("click", () => {
      this._showLegend = !this._showLegend;
      this._render();
    });

    // group-by-artist toggle
    r.querySelector("#f-grp")?.addEventListener("change", ev => {
      this._groupByArtist = ev.target.checked;
      this._render();
    });

    // sortable headers
    r.querySelector("#th-k")?.addEventListener("click", () => this._toggleSort("key"));
    r.querySelector("#th-e")?.addEventListener("click", () => this._toggleSort("enum"));
    r.querySelector("#th-l")?.addEventListener("click", () => this._toggleSort("last_seen"));

    // enum inputs — save on blur, Enter triggers blur, Escape resets
    r.querySelectorAll(".ei").forEach(inp => {
      inp.addEventListener("keydown", ev => {
        if (ev.key === "Enter")  { ev.preventDefault(); inp.blur(); }
        if (ev.key === "Escape") { inp.value = inp.dataset.original; inp.blur(); }
      });
      inp.addEventListener("blur", () => {
        const orig = parseInt(inp.dataset.original, 10);
        const val  = parseInt(inp.value, 10);
        if (isNaN(val))         { inp.value = orig; return; }
        if (val === orig)       return;
        if (val < 0 || val > 9) {
          this._toast("Wert muss 0–9 sein", "error");
          inp.value = orig;
          return;
        }
        this._save(inp.dataset.eid, inp.dataset.key, val, inp);
      });
    });

    // pagination
    r.querySelectorAll(".pb").forEach(b =>
      b.addEventListener("click", () => { this._page = +b.dataset.p; this._render(); })
    );
    r.querySelector("#pg-p")?.addEventListener("click", () => {
      if (this._page > 1) { this._page--; this._render(); }
    });
    r.querySelector("#pg-n")?.addEventListener("click", () => {
      if (this._page < totalPages) { this._page++; this._render(); }
    });
  }

  // ── utilities ─────────────────────────────────────────────────────────────

  _renderSignature(page) {
    return JSON.stringify({
      sources:            this._sources,
      entries:            this._entries,
      filterSource:       this._filterSource,
      filterUnclassified: this._filterUnclassified,
      filterSearch:       this._filterSearch,
      sortBy:             this._sortBy,
      sortAsc:            this._sortAsc,
      groupByArtist:      this._groupByArtist,
      showLegend:         this._showLegend,
      page,
    });
  }

  _toast(msg, type = "info") {
    this.shadowRoot?.querySelectorAll(".toast").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    this.shadowRoot.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  _rel(iso) {
    if (!iso) return "—";
    const s = Math.floor(Math.abs(Date.now() - new Date(iso)) / 1000);
    if (isNaN(s))   return iso;
    if (s < 60)     return `${s}s`;
    if (s < 3600)   return `${Math.floor(s / 60)}m`;
    if (s < 86400)  return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  _esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}

customElements.define("etm-panel", EtmPanel);
