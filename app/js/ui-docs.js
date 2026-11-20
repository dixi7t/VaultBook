/* VaultBook — Doc Center page (1.49.0): inbox and matching, all documents, missing documents, clean up, CPA package.
 * Accounting is in js/doccenter.js. */
(function () {
  'use strict';
  const U = OB.util, UI = OB.ui, D = OB.docs, S = OB.schema, esc = U.esc;
  const TABS = [['inbox', 'Inbox'], ['all', 'All documents'], ['missing', 'Missing documents'], ['clean', 'Clean up'], ['package', 'CPA package']];
  const kb = (n) => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  let ds = null;
  const fresh = (b) => { const y = +U.today().slice(0, 4) - (+U.today().slice(5, 7) <= 3 ? 1 : 0); return { companyId: b.company.id, from: y + '-01-01', to: y + '-12-31', min: 7500, q: '', pick: {} }; };
  const txLabel = (b, t) => `${S.TXN_TYPES[t.type].label}${t.number ? ' ' + t.number : ''} · ${U.fmtDate(t.date)}${t.contactId ? ' · ' + UI.contactName(t.contactId) : ''} · ${U.fmt(Math.abs(b.txnTotal(t)), { symbol: true })}`;
  const readUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
  function openDoc(a) {
    const m = String(a.data).match(/^data:[^,]*?(;base64)?,/); if (!m) return;
    const body = a.data.slice(m[0].length), bin = m[1] ? atob(body) : decodeURIComponent(body), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: a.type }));
    const w = window.open(url, '_blank'); if (!w) U.download(a.name, new Blob([arr], { type: a.type }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  /** Add files to the inbox; PDFs with a text layer are read for the total, date and vendor. */
  function addFiles(b, files) {
    const list = [...files]; let n = 0, bad = [];
    return list.reduce((p, f) => p.then(() => readUrl(f)).then((url) => {
      if (!url) { bad.push(f.name + ': could not be read'); return; }
      return b.addAttachment({ inbox: true, name: f.name, dataUrl: url }).then((a) => {
        n++;
        if (!/pdf/i.test(a.type) || !UI.pdfText) return;
        return f.arrayBuffer().then((buf) => UI.pdfText(new Uint8Array(buf))).then((r) => {
          const x = D.readText(b, r.text), cur = a.info || {}, info = {};
          if (!cur.amount && x.amount) info.amount = x.amount;
          if (!cur.date && x.date) info.date = x.date;
          if (!cur.vendorId && x.vendorId) info.vendorId = x.vendorId;
          if (Object.keys(info).length) return b.setAttachmentInfo(a.id, info);
        }).catch(() => null);   // a scanned PDF has no text: the name is all there is
      }, (e) => bad.push(f.name + ': ' + e.message));
    }), Promise.resolve()).then(() => { UI.toast(`${n} file${n === 1 ? '' : 's'} added to the inbox.` + (bad.length ? ' ' + bad.join('; ') : ''), bad.length ? 'warn' : undefined); });
  }

  UI.routes.docs = (el, r) => {
    const b = UI.book;
    if (!ds || ds.companyId !== b.company.id) ds = fresh(b);
    const tab = TABS.some((t) => t[0] === r.params.tab) ? r.params.tab : 'inbox';
    if (r.params.from && U.isDate(r.params.from)) ds.from = r.params.from;
    if (r.params.to && U.isDate(r.params.to)) ds.to = r.params.to;
    const inbox = D.inbox(b);
    el.innerHTML = UI.page('Doc Center', `<label class="btn primary" data-testid="dc-add">Add files…<input type="file" id="dc-file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.tif,.tiff,.csv,.xlsx,.xls,.doc,.docx,.txt"></label>`, `
      <nav class="tabs" role="tablist" aria-label="Doc Center">${TABS.map(([k, l]) => `<a role="tab" href="#/docs?tab=${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}" data-testid="dc-tab-${k}">${l}${k === 'inbox' && inbox.length ? ` <span class="badge warn">${inbox.length}</span>` : ''}</a>`).join('')}</nav>
      <div class="dc-drop" id="dc-drop" data-testid="dc-drop">Drop files here (up to 4 MB each)</div>
      <div id="dc-tab">${PANES[tab](b)}</div>`, 'Every receipt, bill and statement in one place.');
    const re = () => UI.render();
    el.querySelector('#dc-file').addEventListener('change', (e) => addFiles(b, e.target.files).then(re));
    const drop = el.querySelector('#dc-drop');
    ['dragenter', 'dragover'].forEach((k) => drop.addEventListener(k, (e) => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((k) => drop.addEventListener(k, () => drop.classList.remove('on')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(b, e.dataTransfer.files).then(re); });
    el.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); const a = b.attachments.find((y) => y.id === x.dataset.open); if (a) openDoc(a); }));
    BIND[tab](el, b, re);
  };

  const PANES = {
    inbox(b) {
      const list = D.inbox(b);
      if (!list.length) return UI.empty('The inbox is empty. Add receipts and bills, and VaultBook suggests the transaction each belongs to.');
      const rows = list.map((a) => ({ a, s: D.suggest(b, a) })), sure = rows.filter((x) => x.s[0] && x.s[0].sure).length;
      return `<div class="form-actions dc-bulk">${sure ? `<button class="btn primary small" id="dc-sure" data-testid="dc-sure">Attach ${sure} sure match${sure === 1 ? '' : 'es'}</button>` : ''}</div>
        <table class="data dc-inbox" data-testid="dc-inbox"><thead><tr><th>Document</th><th>Date</th><th class="num">Amount</th><th>Vendor</th><th>Attach to</th><th></th></tr></thead><tbody>
        ${rows.map(({ a, s }) => { const i = a.info || {}, pick = ds.pick[a.id] || (s[0] ? s[0].t.id : ''); return `<tr data-doc="${esc(a.id)}">
          <td class="dc-name"><a href="#" data-open="${esc(a.id)}">${esc(a.name)}</a><div class="muted small">${esc(kb(a.size))}</div>${(() => { const d = D.dupOf(b, a); return d ? `<div class="small dc-dup">Same file as ${esc(d.name)}${d.ownerId ? ' (attached)' : ''}</div>` : ''; })()}</td>
          <td><input type="date" data-info="date" value="${esc(i.date || '')}" aria-label="Date of ${esc(a.name)}"></td>
          <td><input class="num" data-info="amount" inputmode="decimal" value="${i.amount ? (i.amount / 100).toFixed(2) : ''}" aria-label="Amount of ${esc(a.name)}"></td>
          <td><select data-info="vendorId" aria-label="Vendor of ${esc(a.name)}"><option value="">—</option>${b.contacts.filter((c) => c.active !== false).sort((x, y) => x.name.localeCompare(y.name)).map((c) => `<option value="${esc(c.id)}"${c.id === i.vendorId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
          <td>${s.length ? `<select data-pick aria-label="Transaction for ${esc(a.name)}">${s.map((m) => `<option value="${esc(m.t.id)}"${m.t.id === pick ? ' selected' : ''}>${esc(txLabel(b, m.t))}${m.has ? ' (has a document)' : ''}</option>`).join('')}</select>
            <div class="small ${s[0].sure ? 'dc-sure' : 'muted'}">${s[0].sure ? 'Sure match' : 'Check this one'}${s[0].why.length ? ': ' + esc(s[0].why.join(', ')) : ''}</div>` : '<span class="muted small">No match yet. Enter the amount or date.</span>'}</td>
          <td class="nowrap">${s.length ? `<button class="btn small primary" data-attach data-testid="dc-attach">Attach</button> ` : ''}<button class="btn small ghost" data-rm="${esc(a.id)}">Remove</button></td></tr>`; }).join('')}
        </tbody></table>`;
    },
    all(b) {
      const q = ds.q.toLowerCase(), list = D.all(b).filter((a) => {
        if (!q) return true; const t = a.ownerId && b.txById[a.ownerId], i = a.info || {};
        return (a.name + ' ' + (t ? txLabel(b, t) : 'inbox') + ' ' + (i.vendorId ? UI.contactName(i.vendorId) : '')).toLowerCase().indexOf(q) >= 0;
      }).sort((x, y) => x.addedAt < y.addedAt ? 1 : -1);
      return `<div class="toolbar"><input type="search" id="dc-q" placeholder="Search file name, vendor, amount or transaction" value="${esc(ds.q)}" aria-label="Search documents"></div>
        ${list.length ? `<table class="data" data-testid="dc-all"><thead><tr><th>Document</th><th>Attached to</th><th class="num">Size</th><th>Added</th><th></th></tr></thead><tbody>
        ${list.map((a) => { const t = a.ownerId && b.txById[a.ownerId], other = a.ownerId && !t; return `<tr><td><a href="#" data-open="${esc(a.id)}">${esc(a.name)}</a></td>
          <td>${t ? `<a href="#/txn/${esc(t.id)}">${esc(txLabel(b, t))}</a>${t.status === 'void' ? ' <span class="badge warn">void</span>' : ''}` : other ? '<span class="muted">A contact or fixed asset</span>' : '<span class="badge">Inbox</span>'}</td>
          <td class="num">${esc(kb(a.size || 0))}</td><td>${esc(new Date(a.addedAt).toLocaleDateString())}</td>
          <td class="nowrap">${t ? `<button class="btn small ghost" data-unlink="${esc(a.id)}">Move to inbox</button>` : ''}</td></tr>`; }).join('')}</tbody></table>` : UI.empty(q ? 'No documents match.' : 'No documents yet.')}`;
    },
    missing(b) {
      const list = D.missing(b, { from: ds.from, to: ds.to, min: ds.min });
      return `<div class="toolbar dc-period"><label>From <input type="date" id="dc-from" value="${esc(ds.from)}"></label><label>To <input type="date" id="dc-to" value="${esc(ds.to)}"></label>
        <label>At least <input id="dc-min" class="num" inputmode="decimal" value="${(ds.min / 100).toFixed(2)}" aria-label="Smallest amount"></label>
        ${list.length ? '<button class="btn small" id="dc-mcsv">Download the list for the client (CSV)</button>' : ''}</div>
        ${list.length ? `<p><b>${list.length}</b> transaction${list.length === 1 ? '' : 's'} · ${UI.money(U.sum(list, (t) => Math.abs(b.txnTotal(t))), { symbol: true })}</p>
        <table class="data" data-testid="dc-missing"><thead><tr><th>Date</th><th>Transaction</th><th>Name</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead><tbody>
        ${list.map((t) => `<tr data-tx="${esc(t.id)}"><td>${UI.date(t.date)}</td><td><a href="#/txn/${esc(t.id)}">${esc(S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : ''))}</a></td><td>${esc(UI.contactName(t.contactId))}</td>
          <td class="memo">${esc(t.accountId ? b.accountLabel(t.accountId) : '')}</td><td class="num">${UI.money(Math.abs(b.txnTotal(t)))}</td>
          <td class="nowrap"><label class="btn small">Attach file…<input type="file" data-direct hidden></label></td></tr>`).join('')}</tbody></table>` : UI.empty('Every transaction in this period at or over that amount has a document.')}`;
    },
    clean(b) {
      const c = D.cleanup(b), sec = (key, title, why, list) => `<section class="card dc-clean"><div class="card-head"><h2>${title} <span class="muted">(${list.length})</span></h2>${list.length ? `<button class="btn small danger" data-clean="${key}">Remove selected</button>` : ''}</div>
        <p class="muted small">${why}</p>${list.length ? `<table class="data compact"><tbody>${list.map((a) => { const t = a.ownerId && b.txById[a.ownerId]; return `<tr><td class="pe-c"><input type="checkbox" data-sel="${key}" value="${esc(a.id)}"${key !== 'large' ? ' checked' : ''} aria-label="Select ${esc(a.name)}"></td><td><a href="#" data-open="${esc(a.id)}">${esc(a.name)}</a></td><td class="muted">${t ? esc(txLabel(b, t)) : 'Inbox'}</td><td class="num">${esc(kb(a.size || 0))}</td></tr>`; }).join('')}</tbody></table>` : '<p class="small">Nothing to clean up.</p>'}</section>`;
      return `<p>All documents: <b>${D.all(b).length}</b> · ${esc(kb(c.bytes))}</p>
        ${sec('dupes', 'The same file twice', 'A later copy of a file already on the same transaction (or in the inbox). The first copy stays.', c.dupes)}
        ${sec('onVoid', 'Files on void transactions', 'The transaction was voided. Remove the file, or move it to the inbox in All documents to attach it elsewhere.', c.onVoid)}
        ${sec('large', 'Large files (1 MB or more)', 'Large files make the company file and its backups slower. Replace them with a smaller scan if you can.', c.large)}`;
    },
    package(b) {
      const p = D.packageFiles(b, { from: ds.from, to: ds.to });
      return `<div class="toolbar dc-period"><label>From <input type="date" id="dc-from" value="${esc(ds.from)}"></label><label>To <input type="date" id="dc-to" value="${esc(ds.to)}"></label></div>
        <section class="card"><h2>Document package for the CPA</h2><p>One zip file with every document on transactions in this period, each named <code>date - vendor - amount - type number</code>, and <code>Index.csv</code> listing the transactions and their files.</p>
        <p><b>${p.count}</b> document${p.count === 1 ? '' : 's'}${p.missing ? ` · <a href="#/docs?tab=missing">${p.missing} spending transaction${p.missing === 1 ? '' : 's'} without one</a>` : ''}</p>
        <div class="form-actions"><button class="btn primary" id="dc-zip" data-testid="dc-zip"${p.count ? '' : ' disabled'}>Download the package (.zip)</button></div></section>`;
    }
  };

  const period = (el, re) => {
    U.dateCommit(el.querySelector('#dc-from'), (v) => { if (U.isDate(v)) ds.from = v; }, re);
    U.dateCommit(el.querySelector('#dc-to'), (v) => { if (U.isDate(v)) ds.to = v; }, re);
  };
  const BIND = {
    inbox(el, b, re) {
      el.querySelectorAll('tr[data-doc]').forEach((tr) => {
        const id = tr.dataset.doc, save = (k, v) => { const o = {}; o[k] = v; delete ds.pick[id]; return b.setAttachmentInfo(id, o).then(re, UI.error); };
        U.dateCommit(tr.querySelector('[data-info=date]'), (v) => { tr.dataset.d = U.isDate(v) ? v : ''; }, () => save('date', tr.dataset.d || ''));
        tr.querySelector('[data-info=amount]').addEventListener('change', (e) => { let c = 0; try { c = Math.abs(U.toCents(e.target.value || 0)); } catch (er) { UI.toast('Enter an amount.', 'warn'); return; } save('amount', c); });
        tr.querySelector('[data-info=vendorId]').addEventListener('change', (e) => save('vendorId', e.target.value));
        const pk = tr.querySelector('[data-pick]'); if (pk) pk.addEventListener('change', () => { ds.pick[id] = pk.value; });
        const at = tr.querySelector('[data-attach]'); if (at) at.addEventListener('click', () => UI.busy(at, () => b.linkAttachment(id, pk.value).then(() => { delete ds.pick[id]; UI.toast('Attached.'); re(); }, UI.error)));
      });
      const sure = el.querySelector('#dc-sure');
      if (sure) sure.addEventListener('click', () => UI.busy(sure, () => {
        const go = D.inbox(b).map((a) => ({ a, s: D.suggest(b, a)[0] })).filter((x) => x.s && x.s.sure);
        return go.reduce((p, x) => p.then(() => b.linkAttachment(x.a.id, x.s.t.id)), Promise.resolve()).then(() => { UI.toast(`Attached ${go.length} document${go.length === 1 ? '' : 's'}.`); re(); }, UI.error);
      }));
      el.querySelectorAll('[data-rm]').forEach((x) => x.addEventListener('click', () => UI.confirm('Remove document', '<p>Remove this file from the inbox? The removal is recorded in the audit log.</p>', { ok: 'Remove', danger: true }).then((ok) => ok && b.removeAttachment(x.dataset.rm).then(re, UI.error))));
    },
    all(el, b, re) {
      const q = el.querySelector('#dc-q');
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { ds.q = q.value; re(); } });
      q.addEventListener('search', () => { ds.q = q.value; re(); });
      el.querySelectorAll('[data-unlink]').forEach((x) => x.addEventListener('click', () => b.unlinkAttachment(x.dataset.unlink).then(() => { UI.toast('Moved to the inbox.'); re(); }, UI.error)));
    },
    missing(el, b, re) {
      period(el, re);
      el.querySelector('#dc-min').addEventListener('change', (e) => { try { ds.min = Math.abs(U.toCents(e.target.value || 0)); re(); } catch (er) { UI.toast('Enter an amount.', 'warn'); } });
      el.querySelectorAll('[data-direct]').forEach((inp) => inp.addEventListener('change', () => {
        const id = inp.closest('tr').dataset.tx, f = inp.files[0]; if (!f) return;
        readUrl(f).then((url) => url ? b.addAttachment({ ownerId: id, name: f.name, dataUrl: url }) : Promise.reject(new Error('Could not read ' + f.name))).then(() => { UI.toast('Attached ' + f.name + '.'); re(); }, UI.error);
      }));
      const csv = el.querySelector('#dc-mcsv');
      if (csv) csv.addEventListener('click', () => {
        const rows = [['Date', 'Transaction', 'Name', 'Amount', 'Please send']].concat(D.missing(b, { from: ds.from, to: ds.to, min: ds.min }).map((t) => [t.date, S.TXN_TYPES[t.type].label + (t.number ? ' ' + t.number : ''), UI.contactName(t.contactId), U.fmtPlain(Math.abs(b.txnTotal(t))), t.type === 'bill' ? 'Bill' : 'Receipt']));
        U.download(U.safeFileName(b.company.name + ' documents needed ' + ds.from + ' to ' + ds.to) + '.csv', U.toCSV(rows), 'text/csv');
      });
    },
    clean(el, b, re) {
      el.querySelectorAll('[data-clean]').forEach((x) => x.addEventListener('click', () => {
        const ids = [...el.querySelectorAll(`[data-sel="${x.dataset.clean}"]:checked`)].map((c) => c.value);
        if (!ids.length) { UI.toast('Tick the files to remove first.', 'warn'); return; }
        UI.confirm('Remove documents', `<p>Remove ${ids.length} file${ids.length === 1 ? '' : 's'}? Each removal is recorded in the audit log.</p>`, { ok: 'Remove', danger: true }).then((ok) => ok && D.remove(b, ids).then(() => { UI.toast(`Removed ${ids.length}.`); re(); }, UI.error));
      }));
    },
    package(el, b, re) {
      period(el, re);
      const z = el.querySelector('#dc-zip');
      if (z) z.addEventListener('click', () => {
        const p = D.packageFiles(b, { from: ds.from, to: ds.to });
        U.download(U.safeFileName(b.company.name + ' documents ' + ds.from + ' to ' + ds.to) + '.zip', new Blob([OB.xlsx.zip(p.files)], { type: 'application/zip' }));
        UI.toast(`Package with ${p.count} document${p.count === 1 ? '' : 's'} downloaded.`);
      });
    }
  };
})();
