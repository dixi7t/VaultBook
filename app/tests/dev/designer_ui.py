"""
VaultBook financial reporting UI test (developer-only, 1.10).
Statement designer (templates, rows, drag and drop, keyboard moves, formulas, validation, save, reload,
export/import JSON), report reconciliation, MTD/QTD, and real PDF / Excel downloads from the designer,
the statement screen and a classic report. Uses a new company with the built-in sample data.
Requires: Python 3 + Playwright (Chromium); openpyxl and pypdf for file checks.
Usage: python3 designer_ui.py /path/to/app/index.html
"""
import asyncio, json, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP
DL = tempfile.mkdtemp(prefix='vb_dz_dl_')
results = []

def check(cond, name, detail=''):
    results.append((bool(cond), name))
    print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail)[:300] + ']') if detail and not cond else ''))

def pdf_text(path):
    import pypdf
    r = pypdf.PdfReader(path, strict=True)
    return len(r.pages), '\n'.join(p.extract_text() for p in r.pages)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_dz_'), viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0]; errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        ev = pg.evaluate
        async def go(h):
            await ev('h => { location.hash = h; }', h); await pg.wait_for_timeout(350)
        async def download(click, after=None):
            async with pg.expect_download() as d:
                await click()
                if after: await after()
            dl = await d.value; path = os.path.join(DL, dl.suggested_filename); await dl.save_as(path); return path
        async def pdf_ok():
            await pg.wait_for_selector('.modal #pdf-paper'); await pg.click('.modal .btn.primary')

        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Designer Co'); await pg.check('#newco input[name=sample]'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.transactions.length > 20", timeout=20000)

        # ---- Reports page, reconciliation, MTD/QTD ----
        await go('#/reports')
        links = await ev("[...document.querySelectorAll('.report-links a')].map(a => a.getAttribute('href'))")
        check('#/designer' in links and '#/report/recon' in links, 'Reports lists the Statement designer and Report Reconciliation')
        await go('#/report/recon'); await pg.wait_for_selector('article.report table')
        t = await pg.inner_text('article.report')
        check('Every report ties to the ledger' in t and 'Does not tie' not in t, 'Report reconciliation: every check ties', t[-300:])
        await go('#/report/pnl?cmp=mtd,qtd,ytd'); await pg.wait_for_selector('table.sb-table')
        heads = await ev("[...document.querySelectorAll('table.sb-table thead th')].map(x => x.textContent.trim())")
        check(any('MTD' in h for h in heads) and any('QTD' in h for h in heads), 'P&L shows MTD and QTD columns', heads)

        # ---- statement PDF and Excel from the statement screen ----
        await go('#/report/pnl?range=thisFY'); await pg.wait_for_selector('table.sb-table')
        net_screen = await ev("[...document.querySelectorAll('table.sb-table tr.r-grand td.num')].map(x => x.textContent.trim())[0]")
        async def st_pdf():
            await pg.click('#st-export'); await pg.click('[data-x=pdf]')
        path = await download(st_pdf, pdf_ok)
        n, txt = pdf_text(path)
        check(open(path, 'rb').read(5) == b'%PDF-' and 'Profit and Loss' in txt and 'Designer Co' in txt, 'Statement exports a real PDF with company and title', path)
        check(net_screen and net_screen in txt, 'PDF shows the same Net Income text as the screen', net_screen)
        check('Page 1 of ' + str(n) in txt, 'PDF has page numbers', txt[-80:])
        check(await ev("(OB.prefs.get('pdfSetup') || {}).paper") == 'letter', 'Page setup choice is remembered')

        # classic report to PDF (Trial Balance), with landscape legal
        await go('#/report/tb'); await pg.wait_for_selector('article.report table')
        async def tb_pdf(): await pg.click('[data-x=pdf]')
        async def legal():
            await pg.wait_for_selector('.modal #pdf-paper'); await pg.select_option('#pdf-paper', 'legal'); await pg.select_option('#pdf-orient', 'landscape'); await pg.click('.modal .btn.primary')
        path = await download(tb_pdf, legal)
        import pypdf
        box = pypdf.PdfReader(path).pages[0].mediabox
        n, txt = pdf_text(path)
        check('Trial Balance' in txt and 'Debit' in txt and round(float(box.width)) == 1008 and round(float(box.height)) == 612, 'Trial Balance PDF on landscape Legal paper', (box.width, box.height))
        await ev("OB.prefs.set('pdfSetup', { paper: 'letter', orientation: 'auto', fontSize: 'auto' })")

        # ---- designer gallery → starter template ----
        await go('#/designer'); await pg.wait_for_selector('.report-links')
        tpls = await ev("[...document.querySelectorAll('.report-links a')].map(a => a.getAttribute('href'))")
        check(sum(1 for x in tpls if 'tpl=' in x) == 4, 'Designer gallery offers 4 starter templates', tpls)
        await pg.click('a[href="#/designer/new?tpl=plmargin"]'); await pg.wait_for_selector('#dz-table table.sb-table', timeout=10000)
        prev = await pg.inner_text('#dz-table')
        check('Gross margin' in prev and '%' in prev and 'Net income' in prev, 'Preview shows the margin template with % rows', prev[:200])
        check(not await ev("!!document.querySelector('#dz-msgs .banner.danger')"), 'Starter template has no errors')
        ni_engine = await ev("""(() => { const b = OB.ui.book, p = OB.designer.normalize(OB.designer.starter('plmargin')); const r = OB.ui.ranges().fyToDate;
            const st = OB.reports.statement(b, { kind: 'pl', from: r[1], to: r[2] }); return OB.reportModel.fmtNumber(st.sections.net.cells[0], {}, { symbol: true }); })()""")
        check(ni_engine in prev, 'Designer net income equals the Profit and Loss engine', ni_engine)
        rows0 = await ev("document.querySelectorAll('#dz-list li[data-i]').length")
        # basic accessibility (axe-core is not available offline): every control has a name, ids are unique
        unnamed = await ev("""[...document.querySelectorAll('[data-testid=designer] button, [data-testid=designer] input:not([type=hidden]):not([hidden]), [data-testid=designer] select')].filter(x => {
            if (x.closest('[hidden]')) return false;
            const lab = x.getAttribute('aria-label') || x.getAttribute('aria-labelledby') || (x.labels && x.labels.length && x.labels[0].textContent.trim()) || x.textContent.trim() || x.title;
            return !lab; }).map(x => x.outerHTML.slice(0, 80))""")
        check(not unnamed, 'Every designer control has an accessible name', unnamed)
        dup = await ev("(() => { const ids = [...document.querySelectorAll('[id]')].map(x => x.id); return ids.filter((x, i) => ids.indexOf(x) !== i); })()")
        check(not dup, 'No duplicate element ids on the designer page', dup)

        # expand a summary row and drill down
        await pg.click('#dz-table [data-tog]'); await pg.wait_for_timeout(200)
        accs = await ev("document.querySelectorAll('#dz-table tr.r-acc td.num a').length")
        check(accs > 0, 'Expanding a summary row shows its accounts with drill-down links', accs)
        await pg.click('#dz-table tr.r-acc td.num a'); await pg.wait_for_timeout(400)
        check((await ev('location.hash')).startswith('#/report/gl'), 'Account amount drills down to the general ledger')
        await pg.go_back(); await pg.wait_for_selector('#dz-list', timeout=10000)
        check(await ev("document.querySelectorAll('#dz-list li[data-i]').length") == rows0, 'Back returns to the same design')

        # add a formula row with a mistake, then fix it
        await pg.click('#dz-list li[data-i="2"]')
        await pg.click('#dz-add'); await pg.click('[data-add=formula]')
        await pg.fill('#dz-row [name=label]', 'Double gross profit')
        await pg.fill('#dz-row [name=formula]', 'gp +'); await pg.wait_for_timeout(400)
        err = await pg.inner_text('#dz-msgs')
        check('ends too early' in err, 'An incomplete formula is reported in plain English', err)
        await pg.fill('#dz-row [name=formula]', 'gp * 2'); await pg.wait_for_timeout(400)
        check('Double gross profit' in await pg.inner_text('#dz-table') and not await ev("!!document.querySelector('#dz-msgs .banner.danger')"), 'Fixed formula row appears in the preview')
        check(await ev("document.querySelectorAll('#dz-list li[data-i]').length") == rows0 + 1 and 'is-dirty' in await ev('document.documentElement.className'), 'Row added and the page shows unsaved changes')
        check(await ev("document.querySelector('#dz-list li[data-i=\"3\"] .dz-lbl').textContent") == 'Double gross profit', 'New row inserted after the selected row')

        # keyboard move: Alt+Up
        await pg.focus('#dz-list'); await pg.keyboard.press('Alt+ArrowUp'); await pg.wait_for_timeout(250)
        check(await ev("document.querySelector('#dz-list li[data-i=\"2\"] .dz-lbl').textContent") == 'Double gross profit', 'Alt+↑ moves the selected row up')
        check('moved to position 3' in await pg.inner_text('#dz-live'), 'Move is announced to screen readers')
        # drag and drop: first row onto the fifth
        first = await ev("document.querySelector('#dz-list li[data-i=\"0\"] .dz-lbl').textContent")
        await pg.drag_and_drop('#dz-list li[data-i="0"]', '#dz-list li[data-i="4"]'); await pg.wait_for_timeout(300)
        check(await ev("document.querySelector('#dz-list li[data-i=\"4\"] .dz-lbl').textContent") == first, 'Drag and drop reorders rows', first)
        await pg.drag_and_drop('#dz-list li[data-i="4"]', '#dz-list li[data-i="0"]'); await pg.wait_for_timeout(300)

        # unmapped account audit: narrow the expense row to one number range
        idx = await ev("[...document.querySelectorAll('#dz-list li[data-i]')].findIndex(li => li.querySelector('.dz-lbl').textContent === 'Operating expenses')")
        await pg.click('#dz-list li[data-i="%d"]' % idx)
        await pg.uncheck('#dz-row [name=atype][value=expense]'); await pg.fill('#dz-row [name=numbers]', '6300-6399'); await pg.wait_for_timeout(400)
        warn = await pg.inner_text('#dz-msgs')
        check('not on this report' in warn and '6400 Rent' in warn, 'Leaving expense accounts out of every row is flagged by name', warn[:200])
        check('opex' in await pg.inner_text('#dz-list') and not await ev("!!document.querySelector('#dz-msgs .banner.danger')"), 'Formulas still work with the narrowed row')
        await pg.click('#dz-addrest'); await pg.wait_for_timeout(400)
        check('not on this report' not in await pg.inner_text('#dz-msgs'), '"Add a row for them" puts every account back on the report')

        # save, reload, persists
        await pg.fill('#dz-name', 'Board pack P&L')
        await pg.click('#dz-save'); await pg.wait_for_timeout(700)
        h = await ev('location.hash')
        check(h.startswith('#/designer/rpt'), 'Saving gives the design its own address', h)
        saved_rows = await ev("document.querySelectorAll('#dz-list li[data-i]').length")
        await pg.reload(); await pg.wait_for_selector('#dz-list li[data-i]', timeout=15000)
        check(await ev("document.querySelectorAll('#dz-list li[data-i]').length") == saved_rows and await pg.input_value('#dz-name') == 'Board pack P&L', 'Saved design survives a reload', saved_rows)
        await go('#/reports'); await pg.wait_for_selector('.my-reports')
        check('Board pack P&L' in await pg.inner_text('.my-reports') and 'Statement designer' in await pg.inner_text('.my-reports'), 'Saved design is listed in My reports')
        await go(h); await pg.wait_for_selector('#dz-table table.sb-table')

        # Excel export: live formulas, same values
        async def xl(): await pg.click('[data-testid=designer] [data-x=xlsx]')
        path = await download(xl)
        import openpyxl
        wv = openpyxl.load_workbook(path, data_only=True).active; wf = openpyxl.load_workbook(path).active
        vals = [c.value for r in wv.iter_rows() for c in r if c.value is not None]
        fs = [c.value for r in wf.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith('=')]
        check('Gross margin' in vals and len(fs) >= 5 and wf.freeze_panes, 'Designer Excel has labels, live formulas and frozen headings', fs[:4])
        # PDF export
        async def dpdf(): await pg.click('[data-testid=designer] [data-x=pdf]')
        path = await download(dpdf, pdf_ok)
        n, txt = pdf_text(path)
        check('Board pack P&L' in txt and 'Gross margin' in txt and 'Page 1 of' in txt, 'Designer PDF has the title, rows and page numbers')

        # template JSON export → import
        await pg.click('#dz-more')
        async def ex(): await pg.click('[data-m=export]')
        path = await download(ex)
        tj = json.load(open(path))
        check(tj.get('format') == 'vaultbook-report-template' and tj.get('$schema') and len(tj['rows']) == saved_rows, 'Template exports as versioned JSON with its schema id', list(tj.keys()))
        await go('#/designer'); await pg.wait_for_selector('#dz-file', state='attached')
        await pg.set_input_files('#dz-file', path); await pg.wait_for_selector('#dz-list li[data-i]', timeout=10000)
        check(await ev("document.querySelectorAll('#dz-list li[data-i]').length") == saved_rows and 'is-dirty' in await ev('document.documentElement.className'), 'Imported template opens as an unsaved design', (await ev("document.querySelectorAll('#dz-list li[data-i]').length"), saved_rows, await ev('location.hash'), await ev('document.documentElement.className')))
        bad = os.path.join(DL, 'bad.json'); open(bad, 'w').write('{"format":"vaultbook-report-template","version":1,"kind":"pl","rows":[{"type":"formula","formula":"a +"}]}')
        await ev("OB.ui.dirty = false"); await go('#/designer'); await pg.wait_for_selector('#dz-file', state='attached')
        await pg.set_input_files('#dz-file', bad); await pg.wait_for_timeout(500)
        check('ends too early' in await pg.inner_text('body'), 'A broken template file is refused with the reason')

        # unsaved-changes guard
        await go(h); await pg.wait_for_selector('#dz-name')
        await pg.fill('#dz-name', 'Board pack P&L v2')
        await pg.click('a[href="#/designer"].back'); await pg.wait_for_timeout(300)
        check(await ev("!!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('Unsaved changes')"), 'Leaving with unsaved changes asks first')
        await pg.click('.modal .btn.danger'); await pg.wait_for_timeout(300)

        # balance sheet ratios template
        await go('#/designer/new?tpl=bsratios'); await pg.wait_for_selector('#dz-table table.sb-table')
        t = await pg.inner_text('#dz-table')
        ta = await ev("""(() => { const r = OB.ui.ranges().thisFY; const st = OB.reports.statement(OB.ui.book, { kind: 'bs', from: r[1], to: r[2] }); return OB.reportModel.fmtNumber(st.sections.assets.cells[0], {}, { symbol: true }); })()""")
        check('Current ratio' in t and ta in t, 'Balance sheet ratios template: total assets equal the Balance Sheet', ta)
        check(not await ev("!!document.querySelector('#dz-msgs .banner')"), 'Balance sheet template maps every account (no warnings)')
        await pg.fill('#dz-name', 'Ratios by keyboard'); await pg.focus('#dz-list'); await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(700)
        check((await ev('location.hash')).startswith('#/designer/rpt') and await ev("OB.ui.book.reports.some(r => r.name === 'Ratios by keyboard' && r.report === 'designer')"), 'Ctrl+S saves the design')

        check(not errors, 'No JavaScript errors during the run', errors[:3])
        await ctx.close()
    fails = [n for ok, n in results if not ok]
    print('\n%d passed, %d failed' % (len(results) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)

asyncio.run(main())
