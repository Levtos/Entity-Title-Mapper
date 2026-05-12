// Entity Title Mapper – Title Classifier panel
// Uses Home Assistant WebSocket commands for authenticated ETM access.
// Number inputs are always visible; Save/Enter persists changes explicitly.

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

  async _save(entryId, key, value, inputEl, buttonEl = null) {
    try {
      this._setSaving(inputEl, buttonEl, true);
      await this._ws({ type: "etm/update_entry", entry_id: entryId, key, enum_value: value });
      const e = this._entries.find(e => e.entry_id === entryId && e.key === key);
      if (e) e.enum = value;
      inputEl.dataset.original = String(value);
      inputEl.value = String(value);
      this._setInputDirty(inputEl, buttonEl, false);
      this._flash(inputEl, "saved");
      this._toast("Wert gespeichert", "success");
    } catch (err) {
      this._toast(`Speichern fehlgeschlagen: ${err.message}`, "error");
      inputEl.value = inputEl.dataset.original;
      this._setInputDirty(inputEl, buttonEl, false);
      this._flash(inputEl, "err");
    } finally {
      this._setSaving(inputEl, buttonEl, false);
    }
  }

  _saveInput(inputEl) {
    const orig = parseInt(inputEl.dataset.original, 10);
    const val  = parseInt(inputEl.value, 10);
    const buttonEl = this.shadowRoot?.querySelector(
      `.save-row[data-eid="${CSS.escape(inputEl.dataset.eid)}"][data-key="${CSS.escape(inputEl.dataset.key)}"]`
    );
    if (isNaN(val)) { inputEl.value = orig; return; }
    if (val === orig) { this._setInputDirty(inputEl, buttonEl, false); return; }
    if (val < 0 || val > 9) {
      this._toast("Wert muss 0–9 sein", "error");
      inputEl.value = orig;
      this._setInputDirty(inputEl, buttonEl, false);
      return;
    }
    this._save(inputEl.dataset.eid, inputEl.dataset.key, val, inputEl, buttonEl);
  }

  _setInputDirty(inputEl, buttonEl, dirty) {
    inputEl.classList.toggle("dirty", dirty);
    if (buttonEl) buttonEl.disabled = !dirty;
  }

  _setSaving(inputEl, buttonEl, saving) {
    inputEl.disabled = saving;
    if (buttonEl) {
      buttonEl.disabled = saving || inputEl.value === inputEl.dataset.original;
      buttonEl.textContent = saving ? "…" : "Speichern";
    }
  }

  _flash(el, cls) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 900);
  }

  // ── sorting ───────────────────────────────────────────────────────────────

  _sorted() {
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
      this._sortAsc = col !== "last_seen";
    }
    this._render();
  }

  // ── render ────────────────────────────────────────────────────────────────

  _render(force = false) {
    if (!this.shadowRoot) return;

    const savedFocus = this.shadowRoot.activeElement?.classList?.contains("ei")
      ? { eid: this.shadowRoot.activeElement.dataset.eid, key: this.shadowRoot.activeElement.dataset.key }
      : null;

    const sorted     = this._sorted();
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
    const page       = Math.min(this._page, totalPages);
    if (this._page !== page) this._page = page;
    const rows       = sorted.slice((page - 1) * this._pageSize, page * this._pageSize);
    const signature  = this._renderSignature(page);
    if (!force && signature === this._lastRenderSignature) return;
    this._lastRenderSignature = signature;

    const arr = col =>
      this._sortBy !== col
        ? `<span class="sh">↕</span>`
        : `<span class="sa">${this._sortAsc ? "↑" : "↓"}</span>`;

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
select           { min-width: 130px; }
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
.enum-cell { display: flex; align-items: center; gap: 8px; }
.ei:focus { outline: none; border-color: var(--primary-color); }
.ei.dirty { border-color: var(--warning-color, #ffa600); }
.ei.saved {
  border-color: var(--success-color, #4caf50);
  background: color-mix(in srgb, var(--success-color, #4caf50) 14%, transparent);
}
.ei.err {
  border-color: var(--error-color, #f44336);
  background: color-mix(in srgb, var(--error-color, #f44336) 14%, transparent);
}
.save-row { height: 30px; padding: 0 10px; }
.save-row:disabled { cursor: default; opacity: .45; }

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
  <button class="btn btn-p" id="btn-apply">Filter anwenden</button>
  <button class="btn btn-g" id="btn-ref" title="Jetzt aktualisieren">↻</button>
</div>

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
        <th id="th-e" style="width:180px">Wert ${arr("enum")}</th>
        <th id="th-l">Zuletzt ${arr("last_seen")}</th>
      </tr>
    </thead>
    <tbody>
      ${rows.length === 0
        ? `<tr><td class="empty" colspan="4">${this._loading ? "Lädt …" : "Keine Einträge gefunden."}</td></tr>`
        : rows.map(e => `
<tr class="${e.enum === 0 ? "zero" : ""}${e.is_current ? " current" : ""}">
  <td class="key">${this._esc(e.key)}${e.is_current ? '<span class="badge">aktiv</span>' : ""}</td>
  <td><span class="src">${this._esc(e.source_name)}</span></td>
  <td>
    <div class="enum-cell">
      <input class="ei" type="number" min="0" max="9" step="1"
             value="${e.enum}" data-original="${e.enum}"
             data-eid="${this._esc(e.entry_id)}" data-key="${this._esc(e.key)}" />
      <button class="btn btn-g save-row" disabled
              data-eid="${this._esc(e.entry_id)}" data-key="${this._esc(e.key)}">Speichern</button>
    </div>
  </td>
  <td>${this._rel(e.last_seen)}</td>
</tr>`).join("")}
    </tbody>
  </table>
</div>

${totalPages > 1 ? this._pagHtml(page, totalPages) : ""}
`;

    this._wire(page, totalPages);
    if (savedFocus) {
      this.shadowRoot
        .querySelector(`.ei[data-eid="${CSS.escape(savedFocus.eid)}"][data-key="${CSS.escape(savedFocus.key)}"]`)
        ?.focus();
    }
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

    // sortable headers
    r.querySelector("#th-k")?.addEventListener("click", () => this._toggleSort("key"));
    r.querySelector("#th-e")?.addEventListener("click", () => this._toggleSort("enum"));
    r.querySelector("#th-l")?.addEventListener("click", () => this._toggleSort("last_seen"));

    // enum inputs — explicit save button; Enter saves, Escape resets
    r.querySelectorAll(".ei").forEach(inp => {
      const btn = r.querySelector(
        `.save-row[data-eid="${CSS.escape(inp.dataset.eid)}"][data-key="${CSS.escape(inp.dataset.key)}"]`
      );
      inp.addEventListener("input", () => {
        this._setInputDirty(inp, btn, inp.value !== inp.dataset.original);
      });
      inp.addEventListener("keydown", ev => {
        if (ev.key === "Enter") { ev.preventDefault(); this._saveInput(inp); }
        if (ev.key === "Escape") {
          inp.value = inp.dataset.original;
          this._setInputDirty(inp, btn, false);
          inp.blur();
        }
      });
    });
    r.querySelectorAll(".save-row").forEach(btn => {
      btn.addEventListener("click", () => {
        const inp = r.querySelector(
          `.ei[data-eid="${CSS.escape(btn.dataset.eid)}"][data-key="${CSS.escape(btn.dataset.key)}"]`
        );
        if (inp) this._saveInput(inp);
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
      sources: this._sources,
      entries: this._entries,
      filterSource: this._filterSource,
      filterUnclassified: this._filterUnclassified,
      filterSearch: this._filterSearch,
      sortBy: this._sortBy,
      sortAsc: this._sortAsc,
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
