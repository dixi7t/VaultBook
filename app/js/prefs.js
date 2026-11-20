/* OfflineBooks US — UI preferences (theme, density, sidebar, table layouts).
 * Stored in localStorage as one versioned JSON record. These are display preferences only —
 * never accounting data — so they live outside the (optionally encrypted) company databases.
 * If localStorage is unavailable (blocked site data), preferences work for the session only.
 */
(function (root) {
  'use strict';
  var OB = root.OB = root.OB || {};
  var KEY = 'OfflineBooksUS.prefs.v1';
  var DEFAULTS = { theme: 'system', density: 'comfortable', sidebarCollapsed: true, tables: {} };
  var mem = null, persistent = true;

  function load() {
    if (mem) return mem;
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { persistent = false; }
    try { mem = Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {}); } catch (e) { mem = Object.assign({}, DEFAULTS); }
    if (!mem.tables || typeof mem.tables !== 'object') mem.tables = {};
    return mem;
  }
  function save() {
    try { root.localStorage.setItem(KEY, JSON.stringify(mem)); persistent = true; } catch (e) { persistent = false; }
  }
  OB.prefs = {
    get: function (k) { return load()[k]; },
    set: function (k, v) { load()[k] = v; save(); return v; },
    table: function (key) { var t = load().tables; return t[key] || (t[key] = { widths: {}, hidden: [] }); },
    saveTable: function (key, v) { load().tables[key] = v; save(); },
    resetTables: function () { load().tables = {}; save(); },
    isPersistent: function () { load(); return persistent; },
    KEY: KEY
  };
})(typeof window !== 'undefined' ? window : globalThis);
