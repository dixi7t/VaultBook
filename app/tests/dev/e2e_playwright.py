"""
Developer end-to-end test (NOT needed to run the app).
Drives the real app over file:// in Chromium with a persistent profile, including a
full browser restart to prove data persistence.
Requires: Python 3 + Playwright (pip install playwright; playwright install chromium).
Usage: python e2e_playwright.py /path/to/OfflineBooks_US/index.html
"""
import asyncio, json, os, shutil, sys, tempfile, zipfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP if not APP.startswith('file://') else APP
SHOTS = os.environ.get('SHOTS', '')
PROFILE = tempfile.mkdtemp(prefix='ob_e2e_')
DL = tempfile.mkdtemp(prefix='ob_dl_')
results = []

def check(cond, name, detail=''):
    results.append((bool(cond), name, detail))
    print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def shot(pg, name):
    if SHOTS:
        await pg.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)

async def ev(pg, js):
    return await pg.evaluate(js)

async def discard(pg):
    # let queued change-checks settle, then abandon the form's edits (test shortcut for "Discard changes")
    await pg.wait_for_timeout(80)
    await pg.evaluate("() => { OB.ui.dirty = false; }")

async def export_click(pg, kind):
    # Statement reports (1.7.0+) keep Excel/CSV inside the Export menu; other reports show buttons.
    btn = await pg.query_selector('[data-x=%s]' % kind)
    if btn and not await btn.is_visible() and await pg.query_selector('#st-export'):
        await pg.click('#st-export')
    await pg.click('[data-x=%s]' % kind)

async def nav_click(pg, href):
    # 1.7.0 flyout nav: grouped links live in a hover flyout; hover its group first.
    sel = '.nav a[href="%s"]' % href
    grp = await pg.query_selector('.nav-grp:has(a[href="%s"]) > .nav-parent' % href)
    if grp:
        # move off first: mouseenter does not re-fire if the pointer is already resting on the group
        await pg.mouse.move(900, 600); await pg.wait_for_timeout(250)
        await grp.hover(); await pg.wait_for_timeout(120)
    await pg.click(sel, timeout=5000)

async def go(pg, h):
    await pg.evaluate("h => { location.hash = h }", h)
    await pg.wait_for_timeout(250)

async def select_label(pg, sel, text):
    # choose option whose text contains `text`
    val = await pg.evaluate("""([sel, text]) => { const s = document.querySelector(sel); const o = [...s.options].find(o => o.textContent.includes(text)); if (!o) return null; s.value = o.value; s.dispatchEvent(new Event('change', {bubbles:true})); return o.value; }""", [sel, text])
    if val is None: raise Exception('option not found: ' + sel + ' ' + text)
    return val

async def combo_pick(pg, scope, text):
    """Type into the combobox inside `scope` and press Enter (picks the best match)."""
    inp = scope + ' .combo-input'
    await pg.click(inp)
    await pg.fill(inp, text)
    await pg.keyboard.press('Enter')
    await pg.wait_for_timeout(120)

async def new_contact(pg, name):
    # type a new name in the customer/vendor field -> "+ Add new ..." -> dialog prefilled -> save
    await combo_pick(pg, '.combo:has(input[name=contactId])', name)
    await pg.wait_for_selector('.modal #ct-name')
    assert await pg.input_value('#ct-name') == name
    await pg.click('.modal .btn.primary')
    await pg.wait_for_timeout(300)

async def save_form(pg):
    await pg.click('button[data-after="view"]')
    for _ in range(50):  # poll (the app's CSP forbids string-eval used by wait_for_function)
        h = await pg.evaluate("() => location.hash")
        if h.startswith('#/txn/') and 'new' not in h: break
        await pg.wait_for_timeout(100)
    else:
        errs = await pg.evaluate("() => { const e = document.querySelector('#form-errors'); return e ? e.innerText : 'no error box'; }")
        raise Exception('form did not save: ' + errs)
    await pg.wait_for_timeout(200)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(PROFILE, viewport={'width': 1366, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL)
        await pg.evaluate("localStorage.setItem('OfflineBooksUS.prefs.v1', JSON.stringify({ menubarSeen: true, sidebarCollapsed: false }))"); await pg.reload()   # 1.51.0: these checks use the side menu, which is now off by default
        await pg.wait_for_selector('#newco')
        check(not await pg.is_visible('#sidebar') and await pg.is_visible('#theme-toggle'), 'Welcome screen: no sidebar, theme toggle available')

        # ---- create company ----
        await pg.fill('#newco input[name=name]', 'E2E Test Company')
        await pg.click('#newco button[type=submit]')
        await pg.wait_for_selector('.gateway, .dash', timeout=10000)
        check(await pg.inner_text('#company-name') == 'E2E Test Company', 'Company created and opened')

        # ---- route integrity: every in-app link has a handler; no page silently falls back to the dashboard ----
        import re as _re, glob as _glob
        app_dir = os.path.dirname(APP if not APP.startswith('file://') else APP[7:])
        src = ''.join(open(f, encoding='utf-8').read() for f in _glob.glob(os.path.join(app_dir, 'js', 'ui-*.js')) + [os.path.join(app_dir, 'index.html')])
        linked = sorted(set(_re.findall(r"#/([a-z]+)", src)))
        routes = await ev(pg, 'Object.keys(OB.ui.routes)')
        missing = [r for r in linked if r not in routes]
        check(not missing, 'Every in-app link has a route handler', missing)
        first_acc = await ev(pg, "OB.ui.book.accounts.find(a => a.name === 'Checking').id")
        for h, want in [('#/accounts', 'Chart of accounts'), ('#/register/' + first_acc, 'Checking'), ('#/customers', 'Customers'), ('#/vendors', 'Vendors'),
                        ('#/transactions', 'Transactions'), ('#/reports', 'Reports'), ('#/recurring', 'Recurring'), ('#/rules', 'Bank rules'),
                        ('#/reconcile', 'Reconcile'), ('#/bankfeed', 'Bank feed'), ('#/settings', 'Settings')]:
            await go(pg, h)
            got = await pg.inner_text('main h1')
            check(want in got, 'Route renders its own page: ' + h.split('/')[1], got)

        brand = await ev(pg, "(() => { const l = document.querySelector('.brand .logo-mark').getBoundingClientRect(), t = document.querySelector('.brand-text').getBoundingClientRect(); return Math.abs(l.top - t.top) < 12 && t.left > l.right; })()")
        check(brand, 'Sidebar brand: logo and company name side by side')
        # ---- Example 1: cash sale ----
        await go(pg, '#/txn/new?type=salesReceipt')
        await new_contact(pg, 'Walk-in Customer')
        await select_label(pg, 'select[name=accountId]', 'Checking')
        await pg.fill('input[name=date]', '2025-01-10')
        await combo_pick(pg, 'tr.line', '4000 Sales')
        await pg.fill('tr.line input[data-f=qty]', '1')
        await pg.fill('tr.line input[data-f=rate]', '1000')
        await save_form(pg)
        splits = await ev(pg, "OB.ui.book.transactions.find(t=>t.type==='salesReceipt').splits.map(s=>[OB.ui.book.accById[s.accountId].name, s.amount])")
        check(sorted(splits) == sorted([['Checking', 100000], ['Sales', -100000]]), 'Example 1: Debit Cash $1,000 / Credit Sales $1,000', splits)

        # ---- Example 2: invoice 1000, payment 400 ----
        await go(pg, '#/txn/new?type=invoice')
        await new_contact(pg, 'Acme Corp')
        await pg.fill('input[name=date]', '2025-02-01')
        await combo_pick(pg, 'tr.line', '4100')
        await pg.fill('tr.line input[data-f=description]', 'Consulting')
        await pg.fill('tr.line input[data-f=qty]', '10')
        await pg.fill('tr.line input[data-f=rate]', '100')
        await shot(pg, '03_invoice_form')
        await save_form(pg)
        inv_id = await ev(pg, "location.hash.split('/')[2]")
        await go(pg, '#/txn/new?type=payment&contact=' + await ev(pg, "OB.ui.book.txById['%s'].contactId" % inv_id))
        await pg.fill('input[name=date]', '2025-02-15')
        await pg.fill('input[name=amount]', '400')
        await pg.click('[data-act=autoapply]')
        await shot(pg, '04_payment_form')
        await save_form(pg)
        ar = await ev(pg, "OB.ui.book.accountBalance(OB.ui.book.sys('AR').id)")
        openb = await ev(pg, "OB.ui.book.openBalance('%s')" % inv_id)
        income = await ev(pg, "OB.reports.pnl(OB.ui.book,{from:'2025-01-01',to:'2025-12-31'}).sections.income.totals[0]")
        check(ar == 60000 and openb == 60000, 'Example 2: remaining receivable is $600', (ar, openb))
        check(income == 200000, 'Example 2: revenue counted once ($1,000 sale + $1,000 invoice = $2,000)', income)

        # duplicate payment attempt through UI: payment exceeding open balance is blocked
        await go(pg, '#/txn/new?type=payment&contact=' + await ev(pg, "OB.ui.book.txById['%s'].contactId" % inv_id))
        await pg.fill('input[name=date]', '2025-02-16')
        await pg.fill('[data-app]', '700')
        await pg.click('button[data-after="view"]')
        await pg.wait_for_timeout(400)
        err = await pg.query_selector('#form-errors')
        check(err is not None and 'open' in (await err.inner_text()), 'Overpaying an invoice is blocked with a clear message')
        n_pay = await ev(pg, "OB.ui.book.transactions.filter(t=>t.type==='payment').length")
        check(n_pay == 1, 'No extra payment was posted', n_pay)
        await discard(pg)

        # ---- Example 3: bill 300, pay 100 ----
        await go(pg, '#/txn/new?type=bill')
        await new_contact(pg, 'Office Depot')
        await pg.fill('input[name=date]', '2025-03-01')
        await combo_pick(pg, 'tr.line', 'office sup')
        await pg.fill('tr.line input[data-f=amount]', '300')
        await save_form(pg)
        bill_id = await ev(pg, "location.hash.split('/')[2]")
        vid = await ev(pg, "OB.ui.book.txById['%s'].contactId" % bill_id)
        await go(pg, '#/txn/new?type=billPayment&contact=' + vid)
        await pg.fill('input[name=date]', '2025-03-10')
        await pg.fill('input[name=amount]', '100')
        await pg.click('[data-act=autoapply]')
        await save_form(pg)
        ap = await ev(pg, "OB.ui.book.accountBalance(OB.ui.book.sys('AP').id)")
        exp = await ev(pg, "OB.reports.pnl(OB.ui.book,{from:'2025-01-01',to:'2025-12-31'}).sections.expense.totals[0]")
        check(ap == 20000, 'Example 3: remaining payable is $200', ap)
        check(exp == 30000, 'Example 3: expense counted once ($300)', exp)

        # ---- Example 4: transfer ----
        cash_before = await ev(pg, "OB.ui.book.accounts.filter(a=>a.type==='bank').reduce((s,a)=>s+OB.ui.book.accountBalance(a.id),0)")
        await go(pg, '#/txn/new?type=transfer')
        await select_label(pg, 'select[name=accountId]', 'Checking')
        await select_label(pg, 'select[name=toAccountId]', 'Savings')
        await pg.fill('input[name=date]', '2025-03-15')
        await pg.fill('input[name=amount]', '500')
        await save_form(pg)
        cash_after = await ev(pg, "OB.ui.book.accounts.filter(a=>a.type==='bank').reduce((s,a)=>s+OB.ui.book.accountBalance(a.id),0)")
        ni = await ev(pg, "OB.reports.pnl(OB.ui.book,{from:'2025-01-01',to:'2025-12-31'}).netIncome[0]")
        check(cash_before == cash_after, 'Example 4: total cash unchanged by transfer', (cash_before, cash_after))
        check(ni == 170000, 'Example 4: transfer created no income/expense (net income $1,700)', ni)

        # ---- journal entry: unbalanced blocked, balanced posts ----
        await go(pg, '#/txn/new?type=journal')
        await pg.fill('input[name=date]', '2025-03-31')
        rows = await pg.query_selector_all('tr.jline')
        await combo_pick(pg, 'tr.jline:nth-child(1)', 'Depreciation')
        await pg.fill('tr.jline:nth-child(1) input[data-f=debit]', '50')
        await combo_pick(pg, 'tr.jline:nth-child(2)', 'accum dep')
        check(await pg.input_value('tr.jline:nth-child(2) input[data-f=credit]') == '50.00', 'Journal suggests the balancing amount (credit 50.00)')
        await pg.fill('tr.jline:nth-child(2) input[data-f=credit]', '49.99')
        await pg.click('button[data-after="view"]')
        await pg.wait_for_timeout(300)
        check(await pg.query_selector('#form-errors') is not None, 'Unbalanced journal entry is rejected')
        await pg.fill('tr.jline:nth-child(2) input[data-f=credit]', '50')
        await save_form(pg)
        check(await ev(pg, "OB.ui.book.transactions.filter(t=>t.type==='journal').length") == 1, 'Balanced journal entry posts')

        # ---- journal entry: type-to-search + create a missing ledger inline, then continue ----
        await go(pg, '#/txn/new?type=journal')
        await pg.fill('input[name=date]', '2025-04-30')
        await pg.fill('textarea[name=memo]', 'Equipment rental accrual')
        await pg.click('tr.jline:nth-child(1) .combo-input')
        await pg.fill('tr.jline:nth-child(1) .combo-input', 'util')
        await pg.wait_for_timeout(150)
        sugg = await pg.inner_text('#combo-list')
        check('Utilities' in sugg, 'Typing "util" suggests Utilities', sugg[:80])
        await shot(pg, '15_jv_suggestions')
        await pg.fill('tr.jline:nth-child(1) .combo-input', 'Equipment Rental')
        await pg.wait_for_timeout(150)
        sugg = await pg.inner_text('#combo-list')
        check('Add new account' in sugg, 'Unknown ledger offers "+ Add new account"', sugg[:80])
        await shot(pg, '16_jv_add_new')
        await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.modal #f-name')
        check(await pg.input_value('#f-name') == 'Equipment Rental', 'New-account dialog opens prefilled with the typed name')
        await select_label(pg, '#f-type', 'Other Expense')
        await shot(pg, '17_jv_new_account_dialog')
        await pg.click('.modal .btn.primary')
        await pg.wait_for_timeout(400)
        new_acc = await ev(pg, "(() => { const a = OB.ui.book.accounts.find(a => a.name === 'Equipment Rental'); return a ? a.id + '|' + a.type : '' })()")
        check(new_acc.endswith('|oe'), 'Ledger created with the chosen type', new_acc)
        row_acc = await pg.input_value('tr.jline:nth-child(1) input[data-f=accountId]')
        check(row_acc == new_acc.split('|')[0], 'Journal line now uses the new ledger', row_acc)
        check(await pg.input_value('textarea[name=memo]') == 'Equipment rental accrual', 'Journal entry kept everything typed before the dialog')
        focused = await ev(pg, "document.activeElement.dataset.f || ''")
        check(focused == 'debit', 'Cursor continues to the Debit field', focused)
        await pg.keyboard.type('75')
        await combo_pick(pg, 'tr.jline:nth-child(2)', 'accrued')
        sugg_missing = await pg.query_selector('.modal')
        if sugg_missing:  # "accrued" doesn't exist -> dialog; create it as a liability
            await select_label(pg, '#f-type', 'Other Current Liability')
            await pg.fill('#f-name', 'Accrued Liabilities')
            await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(400)
        check(await pg.input_value('tr.jline:nth-child(2) input[data-f=credit]') == '75.00', 'Second line auto-balanced to credit 75.00')
        nrows = len(await pg.query_selector_all('tr.jline'))
        check(nrows >= 3, 'A blank line stays available at the bottom', nrows)
        await save_form(pg)
        je = await ev(pg, "(() => { const t = OB.ui.book.txById[location.hash.split('/')[2]]; return t.splits.map(s => OB.ui.book.accById[s.accountId].name + ':' + s.amount).sort().join(',') })()")
        check(je == 'Accrued Liabilities:-7500,Equipment Rental:7500', 'Journal entry posted with the new ledgers', je)

        # ---- saved transaction screen layout: form only; journal + history on demand ----
        main_txt = await pg.inner_text('main')
        check('Journal entry (debits and credits)' not in main_txt and 'History (' not in main_txt, 'Saved journal entry shows only the form (no duplicate journal / history blocks)')
        check('Version 1' in main_txt and 'View history' in main_txt, 'Created / version line shown under the title')
        await pg.click('[data-act=more]')
        menu = await pg.inner_text('.menu')
        check('Audit history' in menu and 'Transaction journal' not in menu and 'Reverse' in menu and 'Void' in menu, 'More menu: Reverse, Audit history, Void (no redundant journal view for a JE)', menu.replace('\n', ' | '))
        await shot(pg, '18_jv_saved_more_menu')
        await pg.click('.menu [data-act=history]')
        await pg.wait_for_selector('.drawer'); await pg.wait_for_timeout(350)
        check('Posted Journal Entry' in await pg.inner_text('.drawer'), 'Audit history opens in a side panel')
        await shot(pg, '19_history_drawer')
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(150)
        check(await pg.query_selector('.drawer') is None, 'Esc closes the side panel')

        inv_txn = await ev(pg, "OB.ui.book.transactions.find(t => t.type === 'invoice').id")
        await go(pg, '#/txn/' + inv_txn)
        check(await pg.query_selector('.qbi-tools [data-act=more]') is None, 'Invoice ribbon shows every action (no More menu)')
        await pg.click('.qbi-tools [data-act=journal]')
        await pg.wait_for_selector('.drawer'); await pg.wait_for_timeout(350)
        dtxt = await pg.inner_text('.drawer')
        check('Accounts Receivable' in dtxt and 'Services' in dtxt and 'Totals' in dtxt, 'Invoice: Transaction journal shows its debits and credits on request')
        await shot(pg, '20_invoice_journal_drawer')
        await pg.keyboard.press('Escape')

        # ---- journal hint when money moves against A/R ----
        await go(pg, '#/txn/new?type=journal')
        await combo_pick(pg, 'tr.jline:nth-child(1)', 'Checking')
        await pg.fill('tr.jline:nth-child(1) input[data-f=debit]', '100')
        await combo_pick(pg, 'tr.jline:nth-child(2)', 'Accounts Receivable')
        await pg.wait_for_timeout(150)
        hint = await pg.query_selector('#je-hint')
        check(hint is not None and 'Receive payment' in await hint.inner_text(), 'Bank-vs-A/R journal suggests using Receive payment')
        await shot(pg, '21_jv_ar_hint')
        await discard(pg)

        # ---- date shortcuts ----
        await go(pg, '#/txn/new?type=expense')
        await pg.fill('input[name=date]', '2025-05-10')
        await pg.focus('input[name=date]'); await pg.keyboard.press('+')
        check(await pg.input_value('input[name=date]') == '2025-05-11', 'Date shortcut "+" moves to the next day')
        await discard(pg)

        # ---- void via UI ----
        await go(pg, '#/txn/' + await ev(pg, "OB.ui.book.transactions.find(t=>t.type==='journal' && t.memo !== 'Equipment rental accrual').id"))
        await pg.click('[data-act=more]')
        await pg.click('.menu [data-act=void]')
        await pg.fill('#vreason', 'Entered in error')
        await pg.click('.modal .btn.danger')
        await pg.wait_for_timeout(400)
        st = await ev(pg, "OB.ui.book.transactions.find(t=>t.type==='journal' && t.memo !== 'Equipment rental accrual').status")
        check(st == 'void', 'Voiding keeps the transaction, marked void', st)
        await shot(pg, '05_void_journal')

        # ---- reports ----
        for key in ['pnl', 'bs', 'cf', 'tb', 'gl', 'journal', 'araging', 'apaging', 'custbal', 'vendbal', 'expdetail', 'expvendor', 'txlist']:
            await go(pg, '#/report/%s?range=custom&from=2025-01-01&to=2025-12-31&asOf=2025-12-31' % key)
            await pg.wait_for_selector('article.report', timeout=5000)
            txt = await pg.inner_text('article.report')
            bad = await pg.query_selector('article.report .check-line.bad')
            check(bad is None and 'went wrong' not in txt, 'Report renders and self-checks pass: ' + key)
        await go(pg, '#/report/bs?asOf=2025-12-31')
        await shot(pg, '06_balance_sheet')
        check('Assets equal liabilities plus equity' in await pg.inner_text('article.report'), 'Balance sheet balances')
        await go(pg, '#/report/tb?asOf=2025-12-31')
        check('Debits equal credits' in await pg.inner_text('article.report'), 'Trial balance debits equal credits')
        await go(pg, '#/report/pnl?range=custom&from=2025-01-01&to=2025-12-31&columns=month')
        await shot(pg, '07_pnl_monthly')
        check('Mar 2025' in await pg.inner_text('article.report'), 'Monthly comparative P&L')
        await go(pg, '#/report/araging?asOf=2025-12-31&detail=1')
        check('Ties to Accounts Receivable' in await pg.inner_text('article.report'), 'A/R aging ties to the A/R account')

        # drill-down from P&L to GL
        await go(pg, '#/report/pnl?range=custom&from=2025-01-01&to=2025-12-31')
        await pg.click('table.statement td.num a')
        await pg.wait_for_timeout(300)
        check((await ev(pg, 'location.hash')).startswith('#/report/gl'), 'P&L amount drills down into the general ledger')

        # ---- Excel export ----
        await go(pg, '#/report/pnl?range=custom&from=2025-01-01&to=2025-12-31')
        async with pg.expect_download() as d:
            await export_click(pg, 'xlsx')
        dl = await d.value
        xp = os.path.join(DL, dl.suggested_filename); await dl.save_as(xp)
        try:
            import openpyxl
            # 1.10: subtotals are live formulas; data_only reads the values VaultBook stored with them
            wb = openpyxl.load_workbook(xp, data_only=True); vals = [c.value for r in wb.active.iter_rows() for c in r if c.value is not None]
            check('Net Income' in vals and 1700 in vals, 'Excel export opens and contains Net Income 1,700', vals[-4:])
            wf = openpyxl.load_workbook(xp); fs = [c.value for r in wf.active.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith('=')]
            check(len(fs) > 0 and wf.active.freeze_panes, 'Excel export has subtotal formulas and frozen headings', fs[:3])
        except ImportError:
            check(zipfile.is_zipfile(xp), 'Excel export is a valid zip/xlsx')
        async with pg.expect_download() as d:
            await export_click(pg, 'csv')
        dl = await d.value; cp = os.path.join(DL, dl.suggested_filename); await dl.save_as(cp)
        check('Net Income' in open(cp, encoding='utf-8-sig').read(), 'CSV export contains report rows')

        # ---- backup ----
        await go(pg, '#/settings?tab=backup')
        async with pg.expect_download() as d:
            await pg.click('#bk-dl')
        dl = await d.value; bp = os.path.join(DL, dl.suggested_filename); await dl.save_as(bp)
        bk = json.load(open(bp))
        check(bk['format'] == 'OfflineBooksUS-Backup' and bk['counts']['transactions'] == 8, 'Backup file downloaded with all transactions', bk.get('counts'))

        # ---- integrity page ----
        await go(pg, '#/settings?tab=integrity')
        check('All checks passed' in await pg.inner_text('#ic-out'), 'Data integrity check passes')

        n_before = await ev(pg, 'OB.ui.book.transactions.length')
        await ctx.close()

        # ---- Example 5: close and reopen the browser ----
        ctx = await p.chromium.launch_persistent_context(PROFILE, viewport={'width': 1366, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL)
        await pg.wait_for_selector('.gateway, .dash', timeout=10000)
        n_after = await ev(pg, 'OB.ui.book.transactions.length')
        ar2 = await ev(pg, "OB.ui.book.accountBalance(OB.ui.book.sys('AR').id)")
        check(n_after == n_before and ar2 == 60000, 'Example 5: data persists after closing and reopening the browser', (n_before, n_after, ar2))
        await shot(pg, '02_dashboard')

        # ---- restore backup as a new company ----
        await ev(pg, "OB.ui.closeCompany()")
        await pg.wait_for_selector('#restore-file', state='attached')
        await pg.set_input_files('#restore-file', bp)
        await pg.wait_for_selector('.modal')
        await shot(pg, '08_restore_dialog')
        mtxt = await pg.inner_text('.modal')
        check('Backup verified' in mtxt, 'Restore validates the backup before changing anything')
        await pg.click('.modal button:has-text("Restore as a new company")')
        await pg.wait_for_selector('.gateway, .dash', timeout=10000)
        nm = await pg.inner_text('#company-name')
        check('restored' in nm and await ev(pg, 'OB.ui.book.transactions.length') == n_before, 'Backup restored as a separate company', nm)
        companies = await ev(pg, "OB.db.listCompanies().then(l=>l.length)")
        check(companies == 2, 'Original company untouched; two companies exist', companies)

        # tampered backup is rejected
        bk['data']['transactions'][0]['splits'][0]['amount'] += 1
        tp = os.path.join(DL, 'tampered.json'); json.dump(bk, open(tp, 'w'))
        await go(pg, '#/settings?tab=backup')
        await pg.set_input_files('#bk-file', tp)
        await pg.wait_for_selector('.modal')
        check('cannot be restored' in await pg.inner_text('.modal'), 'Tampered backup is rejected')
        await pg.click('.modal .btn')

        # ---- CSV bank import ----
        csv = os.path.join(DL, 'bank.csv')
        open(csv, 'w').write('Date,Description,Amount\n04/01/2025,STRIPE PAYOUT,1250.00\n04/02/2025,"CITY POWER, INC",-89.99\n04/03/2025,COFFEE SHOP,-4.50\n')
        await go(pg, '#/rules')
        await pg.click('#ru-new')
        await pg.fill('.ru-cond input[data-c=value]', 'power')
        await combo_pick(pg, '.modal .combo:has(#ru-acc)', 'Utilities')
        await pg.click('.modal .btn.primary')
        await pg.wait_for_timeout(300)
        await go(pg, '#/bankfeed?import=1')
        await select_label(pg, '#bfi-acc', 'Checking')
        await pg.set_input_files('[data-testid=bf-file-input]', csv)
        await pg.wait_for_selector('[data-testid=bf-map-next]')
        await pg.click('[data-testid=bf-map-next]')
        await pg.wait_for_selector('[data-testid=bf-import-go]')
        await pg.click('[data-testid=bf-import-go]')
        await pg.wait_for_selector('tr.bf-row')
        await shot(pg, '09_import_review')
        mid = await ev(pg, "[...document.querySelectorAll('tr.bf-row')].find(r => r.textContent.includes('CITY POWER')).querySelector('.bf-mid').textContent")
        check('Utilities' in mid and 'Rule' in mid, 'Bank rule categorized the imported row', mid)
        n0 = await ev(pg, "OB.ui.book.transactions.filter(t => t.importHash && t.status === 'posted').length")
        await ev(pg, "[...document.querySelectorAll('tr.bf-row')].find(r => r.textContent.includes('CITY POWER')).querySelector('[data-act=post]').click()")
        await pg.wait_for_timeout(900)
        await pg.check('#bf-all')
        await combo_pick(pg, '.bf-batch .combo', 'Uncategorized Expense')
        await ev(pg, "document.querySelector('[data-testid=bf-batch-post]').click()")
        await pg.wait_for_timeout(1200)
        posted = await ev(pg, "OB.ui.book.transactions.filter(t => t.importHash && t.status === 'posted').length") - n0
        check(posted == 3, 'Imported 3 bank transactions', posted)
        await go(pg, '#/bankfeed?import=1')
        await select_label(pg, '#bfi-acc', 'Checking')
        await pg.set_input_files('[data-testid=bf-file-input]', csv)
        await pg.wait_for_selector('[data-testid=bf-preview]')
        check('3 already imported' in await pg.inner_text('main'), 'Re-importing the same file flags all rows as duplicates')
        await pg.click('#bfi-cancel')

        # ---- reconciliation ----
        chk = await ev(pg, "OB.ui.book.accounts.find(a=>a.name==='Checking').id")
        bal = await ev(pg, "OB.ui.book.accountBalance('%s')" % chk)
        await go(pg, '#/reconcile?account=%s&date=2025-12-31&ending=%s' % (chk, '%.2f' % (bal / 100)))
        await pg.wait_for_selector('#rc-sum')
        for b in await pg.query_selector_all('[data-all]'):
            await b.click()
        await pg.wait_for_timeout(500)
        await shot(pg, '10_reconcile')
        disabled = await pg.get_attribute('#rc-finish', 'disabled')
        check(disabled is None, 'Reconciliation difference reaches $0.00')
        await pg.click('#rc-finish')
        await pg.wait_for_timeout(600)
        check(await ev(pg, "OB.ui.book.reconciledBalance('%s')" % chk) == bal, 'Reconciliation completed; reconciled balance = book balance')

        # ---- visit every page ----
        for h in ['#/dashboard', '#/accounts', '#/register/' + chk, '#/customers', '#/vendors', '#/transactions', '#/transactions?type=invoice', '#/recurring', '#/rules', '#/reports', '#/import',
                  '#/settings?tab=company', '#/settings?tab=data', '#/settings?tab=audit', '#/settings?tab=storage', '#/reconcile']:
            await go(pg, h)
            check('went wrong' not in await pg.inner_text('main'), 'Page renders: ' + h)
        await go(pg, '#/accounts'); await shot(pg, '11_accounts')
        await go(pg, '#/register/' + chk); await shot(pg, '12_register')
        inv = await ev(pg, "OB.ui.book.transactions.find(t=>t.type==='invoice').id")
        await go(pg, '#/print/' + inv); await shot(pg, '13_invoice_print')
        await go(pg, '#/txn/' + inv); await shot(pg, '14_invoice_view')

        # ================= refinement pass: command bar, appearance, keyboard, toasts =================
        await go(pg, '#/dashboard')
        await pg.keyboard.press('Control+k')
        await pg.wait_for_selector('#pal-q')
        check(await ev(pg, "document.activeElement.id") == 'pal-q', 'Ctrl+K opens the command bar with focus in search')
        await pg.keyboard.type('INV-1001'); await pg.wait_for_timeout(150)
        first = await pg.inner_text('#pal-list li.on')
        check('Invoice INV-1001' in first, 'Command bar finds a transaction by number', first)
        await shot(pg, '25_command_bar')
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        check((await ev(pg, 'location.hash')).startswith('#/txn/') and await pg.query_selector('.palette-backdrop') is None, 'Enter opens the result and closes the command bar')
        await pg.keyboard.press('Control+k'); await pg.keyboard.type('acme'); await pg.wait_for_timeout(150)
        txt = await pg.inner_text('#pal-list')
        check('CUSTOMERS' in txt.upper() and 'Acme Corp' in txt, 'Command bar finds customers by name')
        await pg.fill('#pal-q', '1,000.00'); await pg.wait_for_timeout(150)
        check('Invoice INV-1001' in await pg.inner_text('#pal-list'), 'Command bar finds transactions by amount')
        await pg.fill('#pal-q', 'new jour'); await pg.wait_for_timeout(150)
        check('New journal entry' in await pg.inner_text('#pal-list li.on'), 'Command bar runs actions ("new jour" → New journal entry)')
        await pg.fill('#pal-q', 'zzqqxx'); await pg.wait_for_timeout(150)
        check('No results' in await pg.inner_text('#pal-list'), 'Command bar shows an empty state')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check(await pg.query_selector('.palette-backdrop') is None, 'Esc closes the command bar')
        await pg.click('#btn-search'); await pg.wait_for_selector('#pal-q')
        check(True, 'Sidebar Search button opens the command bar')
        await pg.keyboard.press('Escape')

        await go(pg, '#/transactions')
        await pg.focus('a.row-link'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(300)
        check((await ev(pg, 'location.hash')).startswith('#/txn/'), 'Keyboard: Tab to a transaction row link and Enter opens it')

        await go(pg, '#/settings?tab=storage')
        await pg.click('[data-theme-opt=dark]'); await pg.wait_for_timeout(200)
        check(await ev(pg, 'document.documentElement.dataset.theme') == 'dark', 'Appearance: Dark applies immediately')
        # theme.css (1.4.0+) owns the palette; compare with its --bg token instead of a hard-coded color
        bg = await ev(pg, """(() => { const c = getComputedStyle(document.body).backgroundColor, p = document.createElement('i');
            p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bg'); document.body.appendChild(p);
            const t = getComputedStyle(p).color; p.remove(); const n = c.match(/\\d+/g).slice(0, 3).map(Number);
            return { body: c, token: t, dark: n[0] + n[1] + n[2] < 120 }; })()""")
        check(bg['body'] == bg['token'] and bg['dark'], 'Dark palette is in effect', bg)
        await shot(pg, '26_dark_settings'); await go(pg, '#/dashboard'); await pg.wait_for_timeout(200); await shot(pg, '27_dark_dashboard')
        await go(pg, '#/report/bs?asOf=2025-12-31'); await pg.wait_for_timeout(200); await shot(pg, '28_dark_balance_sheet')
        await pg.emulate_media(media='print')
        light_print = await ev(pg, "(window.dispatchEvent(new Event('beforeprint')), getComputedStyle(document.body).backgroundColor)")
        await ev(pg, "window.dispatchEvent(new Event('afterprint'))"); await pg.emulate_media(media='screen')
        check(light_print == 'rgb(255, 255, 255)' or light_print == 'rgb(237, 241, 239)', 'Printing switches to the light palette', light_print)
        check(await ev(pg, 'document.documentElement.dataset.theme') == 'dark', 'Theme restored after printing')
        await pg.reload(); await pg.wait_for_selector('main .page', timeout=15000); await pg.wait_for_timeout(300)
        check('report/bs' in await ev(pg, 'location.hash'), 'Reload keeps you on the same page')
        check(await ev(pg, 'document.documentElement.dataset.theme') == 'dark', 'Appearance choice persists after reload')
        await go(pg, '#/settings?tab=storage'); await pg.click('[data-theme-opt=system]'); await pg.wait_for_timeout(150)
        check(await ev(pg, "document.documentElement.dataset.theme === undefined"), 'Match Windows clears the override')

        await ev(pg, "document.getElementById('toasts').innerHTML = ''")
        await ev(pg, "['Saved.','Saved.','Saved.'].forEach(m => OB.ui.toast(m))")
        check(await ev(pg, "document.querySelectorAll('#toasts .toast').length") == 1 and '×3' in await pg.inner_text('#toasts'), 'Identical toasts merge with a count')
        await ev(pg, "['a','b','c','d','e'].forEach(m => OB.ui.toast(m))")
        check(await ev(pg, "document.querySelectorAll('#toasts .toast').length") == 3, 'At most 3 toasts on screen')

        await go(pg, '#/transactions')
        await combo_pick(pg, '.toolbar .combo:has(#tx-account)', 'Checking')
        await pg.click('#tx-apply'); await pg.wait_for_timeout(250)
        check('account=' in await ev(pg, 'location.hash'), 'Transactions: account filter uses type-to-search')

        # ================= 1.5: theme toggle, nested scrolling, table tools, unsaved changes, save states, prefs =================
        PREFS = "() => JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1') || '{}')"
        # (1) theme toggle
        await go(pg, '#/dashboard')
        before = await ev(pg, 'OB.ui.effectiveTheme()')
        await pg.click('#theme-toggle'); await pg.wait_for_timeout(100)
        after = await ev(pg, 'OB.ui.effectiveTheme()')
        check(before != after and await ev(pg, 'document.documentElement.dataset.theme') == after, 'Top-bar toggle switches theme instantly', (before, after))
        check((await pg.evaluate(PREFS))['theme'] == after, 'Theme saved in localStorage')
        lbl = await pg.get_attribute('#theme-toggle', 'aria-label')
        check(('light' if after == 'dark' else 'dark') in lbl, 'Toggle label describes the next action', lbl)
        await shot(pg, '29_topbar_toggle')
        await pg.click('#theme-toggle'); await pg.wait_for_timeout(100)
        await go(pg, '#/settings?tab=storage'); await pg.click('[data-theme-opt=system]'); await pg.wait_for_timeout(100)
        check(await ev(pg, 'document.documentElement.dataset.theme === undefined') and (await pg.evaluate(PREFS))['theme'] == 'system', 'Match Windows option still available and saved')

        # (2) nested scrolling + (3) table tools on a long, wide General Ledger
        await ev(pg, """(() => { const b = OB.ui.book, U = OB.util, acc = n => b.accounts.find(a => a.name === n).id, d = [];
            for (let i = 0; i < 300; i++) d.push({ type: i % 2 ? 'expense' : 'deposit', date: U.addDays('2025-06-01', i % 120), accountId: acc('Checking'), memo: 'Scroll test row ' + i + ' with a fairly long memo to make the column wide', lines: [{ accountId: acc(i % 2 ? 'Meals' : 'Sales'), amount: 1000 + i }] });
            return b.postBatch(d); })()""")
        await go(pg, '#/report/gl?range=custom&from=2025-01-01&to=2025-12-31')
        await pg.wait_for_selector('article.report table.tbl')
        geo = await ev(pg, """(() => { const m = document.getElementById('main'), a = document.querySelector('article.report'), se = document.scrollingElement;
            return { body: se.scrollHeight - innerHeight, main: m.scrollHeight - m.clientHeight, art: a.scrollHeight - a.clientHeight }; })()""")
        check(geo['body'] <= 1 and geo['main'] <= 1 and geo['art'] > 500, 'Report scrolls in its own region; window and main do not (no double scrollbars)', geo)
        st = await ev(pg, """(() => { const a = document.querySelector('article.report'); a.scrollTop = 4000;
            const top = a.getBoundingClientRect().top + a.clientTop;
            const th = [...a.querySelectorAll('thead th')].find(t => Math.abs(t.getBoundingClientRect().top - top) <= 1);
            const f = document.getElementById('rp-form').getBoundingClientRect();
            return { stuck: !!th, toolbarVisible: f.top >= 0 && f.bottom <= innerHeight }; })()""")
        check(st['stuck'], 'Table header sticks to the top while scrolling')
        check(st['toolbarVisible'], 'Report filters stay visible while scrolling')
        await shot(pg, '30_gl_scrolled_sticky')
        await ev(pg, "document.querySelector('article.report').scrollTop = 0")
        memo_i = await ev(pg, "[...document.querySelector('article.report table.tbl thead tr').cells].findIndex(c => c.textContent.trim() === 'Memo')")
        w0 = await ev(pg, f"parseInt(document.querySelector('article.report table.tbl colgroup.tw').children[{memo_i}].style.width)")
        h = await pg.query_selector_all('article.report table.tbl thead th .col-resizer')
        box = await h[memo_i].bounding_box()
        await pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); await pg.mouse.down()
        await pg.mouse.move(box['x'] + 140, box['y'] + 5, steps=6); await pg.mouse.up()
        widths = await ev(pg, f"[...document.querySelectorAll('article.report table.tbl')].map(t => parseInt(t.querySelector('colgroup.tw').children[{memo_i}].style.width))")
        check(widths[0] >= w0 + 120 and len(set(widths)) == 1, 'Dragging a column edge resizes it in every ledger section', (w0, widths[:3]))
        await pg.focus(f'article.report table.tbl thead th:nth-child({memo_i + 1}) .col-resizer'); await pg.keyboard.press('ArrowRight')
        w2 = await ev(pg, f"parseInt(document.querySelector('article.report table.tbl colgroup.tw').children[{memo_i}].style.width)")
        check(w2 == widths[0] + 16, 'Keyboard: arrow keys resize the focused column edge', (widths[0], w2))
        sl = await ev(pg, """(() => { const a = document.querySelector('article.report'), c = a.querySelector('table.tbl tbody td.kc0'), edge = a.getBoundingClientRect().left + a.clientLeft;
            a.scrollLeft = 400; const x1 = c.getBoundingClientRect().left; a.scrollLeft = 900; const x2 = c.getBoundingClientRect().left;
            return { moved: a.scrollLeft, edge: Math.round(edge), x1: Math.round(x1), x2: Math.round(x2) }; })()""")
        check(sl['moved'] > 100 and abs(sl['x1'] - sl['edge']) <= 1 and sl['x1'] == sl['x2'], 'Key column pins to the left edge while scrolling sideways', sl)
        await ev(pg, "document.querySelector('article.report').scrollLeft = 0")
        await pg.click('[data-columns-for]'); await pg.wait_for_selector('.cols-pop')
        key_disabled = await ev(pg, "document.querySelector('.cols-pop input[data-i=\"0\"]').disabled")
        await pg.uncheck(f'.cols-pop input[data-i="{memo_i}"]'); await pg.wait_for_timeout(100)
        await shot(pg, '31_columns_menu')
        hiddenw = await ev(pg, f"Math.round(document.querySelector('article.report table.tbl tbody tr:nth-child(2) td:nth-child({memo_i + 1})').getBoundingClientRect().width)")
        check(key_disabled and hiddenw == 0, 'Columns menu hides a column (key column cannot be hidden)', (key_disabled, hiddenw))
        await pg.keyboard.press('Escape')
        await pg.reload(); await pg.wait_for_selector('article.report table.tbl'); await pg.wait_for_timeout(200)
        kept = await ev(pg, f"(() => {{ const c = document.querySelector('article.report table.tbl colgroup.tw').children[{memo_i}]; return [c.style.visibility, OB.prefs.table(document.querySelector('article.report table.tbl').dataset.tkey).widths.Memo]; }})()")
        check(kept[0] == 'collapse' and kept[1] == w2, 'Column widths and hidden columns persist after reload', kept)
        await pg.click('[data-columns-for]'); await pg.click('.cols-pop [data-reset]'); await pg.keyboard.press('Escape')
        check(await ev(pg, f"document.querySelector('article.report table.tbl colgroup.tw').children[{memo_i}].style.visibility") == '', 'Reset layout restores columns')
        await pg.focus(f'article.report table.tbl thead th:nth-child({memo_i + 1}) .col-resizer'); await pg.keyboard.press('ArrowRight')  # leave one saved width for the restart check
        await go(pg, '#/transactions')
        tg = await ev(pg, "(() => { const w = document.querySelector('.scroll-area.table-wrap'), m = document.getElementById('main'); return { list: w.scrollHeight > w.clientHeight, main: m.scrollHeight - m.clientHeight }; })()")
        check(tg['list'] and tg['main'] <= 1, 'Transactions list scrolls inside its own region', tg)

        # (4) unsaved changes + (5) save states
        await go(pg, '#/txn/new?type=expense')
        await combo_pick(pg, 'tr.line', 'Meals')
        await pg.fill('tr.line input[data-f=amount]', '12.34'); await pg.wait_for_timeout(100)
        check(await pg.inner_text('#save-status') == 'Unsaved changes' and await ev(pg, "getComputedStyle(document.querySelector('main h1'), '::after').content.includes('Edited')"), 'Editing shows "Unsaved changes" and an Edited marker')
        await shot(pg, '32_unsaved_indicator')
        await pg.fill('tr.line input[data-f=amount]', ''); await pg.click('tr.line .combo-input'); await pg.fill('tr.line .combo-input', ''); await pg.keyboard.press('Tab'); await pg.wait_for_timeout(150)
        check(await ev(pg, 'OB.ui.dirty') is False, 'Undoing the edits clears the unsaved state (snapshot comparison)')
        await combo_pick(pg, 'tr.line', 'Meals'); await pg.fill('tr.line input[data-f=amount]', '12.34'); await pg.wait_for_timeout(100)
        here = await ev(pg, 'location.hash')
        await nav_click(pg, '#/customers')
        await pg.wait_for_selector('.modal')
        check('Unsaved changes' in await pg.inner_text('.modal') and await ev(pg, 'location.hash') == here, 'Leaving with unsaved changes asks first (and stays put)')
        await shot(pg, '33_leave_dialog')
        await pg.click('.modal button:has-text("Keep editing")'); await pg.wait_for_timeout(150)
        check(await pg.input_value('tr.line input[data-f=amount]') == '12.34', 'Keep editing returns with entries intact')
        await ev(pg, 'history.back()'); await pg.wait_for_selector('.modal', timeout=5000)
        check(await ev(pg, 'location.hash') == here, 'Back button with unsaved changes also asks')
        await pg.click('.modal button:has-text("Keep editing")'); await pg.wait_for_timeout(150)
        # BUG-002 regression: window tabs must not silently discard unsaved entries
        other = await ev(pg, "OB.windows.openOrFocus('#/reports', { background: true }).id")
        await pg.click(f'#window-tabs [data-focus="{other}"]'); await pg.wait_for_timeout(250)
        check(await pg.query_selector('.modal') is not None and 'Unsaved changes' in await pg.inner_text('.modal') and await ev(pg, 'location.hash') == here, 'Switching window tab with unsaved changes asks first (and stays put)')
        await pg.click('.modal button:has-text("Keep editing")'); await pg.wait_for_timeout(150)
        check(await pg.input_value('tr.line input[data-f=amount]') == '12.34' and await ev(pg, 'OB.ui.dirty') is True, 'Keep editing after a tab switch keeps the entries')
        await pg.click(f'#window-tabs [data-close="{await ev(pg, "OB.windows.activeId")}"]'); await pg.wait_for_timeout(250)
        check(await pg.query_selector('.modal') is not None and await ev(pg, 'location.hash') == here, 'Closing the active window with unsaved changes asks first')
        await pg.click('.modal button:has-text("Keep editing")'); await pg.wait_for_timeout(150)
        await ev(pg, f"OB.windows.close('{other}')"); await pg.wait_for_timeout(150)
        check(await pg.query_selector('.modal') is None and await ev(pg, 'location.hash') == here and await pg.input_value('tr.line input[data-f=amount]') == '12.34', 'Closing a background window does not interrupt editing')
        # save failure: storage rejects once
        n0 = await ev(pg, 'OB.ui.book.transactions.length')
        await ev(pg, "(() => { const a = OB.ui.book.adapter, orig = a.putMany; a.putMany = function () { a.putMany = orig; return Promise.reject(new Error('Disk is full (simulated).')); }; })()")
        await pg.click('button[data-after="view"]'); await pg.wait_for_timeout(400)
        check(await pg.inner_text('#save-status') == 'Save failed' and 'Disk is full' in await pg.inner_text('.form-status'), 'Storage failure shows "Save failed" with the reason')
        check(await pg.input_value('tr.line input[data-f=amount]') == '12.34' and await ev(pg, 'OB.ui.book.transactions.length') == n0 and await ev(pg, 'location.hash') == here, 'Entries preserved and nothing posted after a failed save')
        await shot(pg, '34_save_failed')
        # duplicate prevention: slow storage, then click Try again twice + Ctrl+S
        await ev(pg, "(() => { const a = OB.ui.book.adapter, orig = a.putMany; a.putMany = function (ops) { return new Promise(r => setTimeout(r, 500)).then(() => orig.call(a, ops)); }; window.__restore = () => { a.putMany = orig; }; })()")
        await pg.click('.form-status [data-act=retry]')
        await pg.wait_for_timeout(60)
        saving_text = await pg.inner_text('#save-status')
        await pg.evaluate("() => document.querySelector('button[data-after=\"view\"]').click()")
        await pg.keyboard.press('Control+s')
        await pg.wait_for_timeout(1200); await ev(pg, 'window.__restore()')
        check(saving_text == 'Saving…', 'Shows "Saving…" while the write is in progress', saving_text)
        check(await ev(pg, 'OB.ui.book.transactions.length') == n0 + 1, 'Repeated clicks and Ctrl+S during a save post exactly once')
        check(await pg.inner_text('#save-status') == 'Saved' and (await ev(pg, 'location.hash')).startswith('#/txn/txn'), 'Then shows "Saved" and opens the transaction')
        # save from the leave dialog
        await go(pg, '#/txn/new?type=expense')
        await combo_pick(pg, 'tr.line', 'Meals'); await pg.fill('tr.line input[data-f=amount]', '7.77'); await pg.wait_for_timeout(100)
        await nav_click(pg, '#/vendors'); await pg.wait_for_selector('.modal')
        await pg.click('.modal button:has-text("Save")'); await pg.wait_for_timeout(600)
        check(await ev(pg, "location.hash") == '#/vendors' and await ev(pg, "OB.ui.book.transactions.some(t => t.total === 777)"), 'Save from the dialog saves, then continues to the chosen page')
        # discard
        await go(pg, '#/txn/new?type=expense'); await pg.fill('tr.line input[data-f=amount]', '5'); await pg.wait_for_timeout(100)
        await pg.click('.form-actions [data-act=close]'); await pg.wait_for_selector('.modal')
        await pg.click('.modal button:has-text("Discard changes")'); await pg.wait_for_timeout(300)
        check(await ev(pg, 'OB.ui.dirty') is False and 'txn/new' not in await ev(pg, 'location.hash'), 'Discard leaves without saving')

        # (6) density + sidebar, persisted
        await go(pg, '#/transactions')
        rh0 = await ev(pg, "document.querySelector('.scroll-area table.data tbody tr').getBoundingClientRect().height")
        await go(pg, '#/settings?tab=storage'); await pg.click('[data-density-opt=compact]'); await go(pg, '#/transactions')
        rh1 = await ev(pg, "document.querySelector('.scroll-area table.data tbody tr').getBoundingClientRect().height")
        check(rh1 < rh0 and (await pg.evaluate(PREFS))['density'] == 'compact', 'Compact density tightens rows and is saved', (rh0, rh1))
        await shot(pg, '35_compact')
        await pg.click('#nav-toggle'); await pg.wait_for_timeout(100)
        check(not await pg.is_visible('#sidebar') and (await pg.evaluate(PREFS))['sidebarCollapsed'] is True, 'Sidebar collapses from the top bar and is saved')
        await pg.reload(); await pg.wait_for_selector('.page', timeout=15000)
        check(await ev(pg, "document.documentElement.classList.contains('sidebar-collapsed') && document.documentElement.dataset.density === 'compact'"), 'Density and sidebar state survive reload')
        await pg.click('#nav-toggle'); await pg.wait_for_timeout(100)
        check(await pg.is_visible('#sidebar'), 'Sidebar shows again')
        await go(pg, '#/settings?tab=storage'); await pg.click('#theme-toggle'); await pg.wait_for_timeout(100)
        expect_theme = await ev(pg, 'OB.ui.theme')   # kept for the restart check below

        # ================= Company Snapshot =================
        async def tool(pg, tid, act):
            await pg.hover(f'.tile[data-id="{tid}"] .tile-head h2'); await pg.click(f'.tile[data-id="{tid}"] [data-tact={act}]')
        LAYOUT = "() => { const s = (JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1')).snapshot || {})[OB.ui.book.company.id]; return s && s.company; }"
        await go(pg, '#/snapshot')
        await pg.wait_for_selector('.tile')
        ids = await ev(pg, "[...document.querySelectorAll('.tile')].map(t => t.dataset.id)")
        check(len(ids) == 7 and await pg.inner_text('main h1') == 'Company Snapshot', 'Snapshot opens with the 7 default panels', ids)
        await shot(pg, '36_snapshot')
        bar = await ev(pg, "(() => { const r = [...document.querySelectorAll('.tile[data-id=\"incexp\"] .mark[data-go]')].find(m => m.getBoundingClientRect().height > 4).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
        await pg.mouse.click(bar[0], bar[1]); await pg.wait_for_timeout(250)
        check((await ev(pg, 'location.hash')).startswith('#/report/pnl'), 'Clicking a chart bar drills into the P&L for that period')
        await go(pg, '#/snapshot')
        # options: switch to table view, persists
        await tool(pg, 'incexp', 'opts'); await pg.wait_for_selector('.tile-pop')
        await pg.select_option('.tile-pop select[data-opt="view"]', 'table'); await pg.wait_for_timeout(150)
        await pg.select_option('.tile-pop select[data-opt="period"]', 'last12'); await pg.wait_for_timeout(150)
        await shot(pg, '37_tile_options')
        await pg.keyboard.press('Escape')
        check(await pg.query_selector('.tile[data-id="incexp"] .tile-table') is not None and 'Last 12 months' in await pg.inner_text('.tile[data-id="incexp"] .tile-sub'), 'Panel options: table view and date range apply immediately')
        # remove + add back through the gallery
        await tool(pg, 'topcust', 'remove'); await pg.wait_for_timeout(100)
        check(await pg.query_selector('.tile[data-id="topcust"]') is None, 'Removing a panel takes it off the snapshot')
        await pg.click('#snap-add'); await pg.wait_for_selector('.gallery')
        check(await pg.query_selector('.gal-card [data-add="topcust"]') is not None and await pg.query_selector('.gal-preview svg, .gal-preview .kpi-grid, .gal-preview .ranked, .gal-preview table') is not None, 'Removed panel is back in the gallery, with live previews')
        await shot(pg, '38_gallery')
        await pg.click('[data-add="topcust"]'); await pg.click('[data-add="keyfig"]'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(250)
        check(await pg.query_selector('.tile[data-id="topcust"]') is not None and await pg.query_selector('.tile[data-id="keyfig"]') is not None, 'Add content adds panels')
        # drag by header to the top of column 3
        src = await pg.query_selector('.tile[data-id="accbal"] .tile-head h2'); sb = await src.bounding_box()
        dst = await pg.query_selector('.snap-col[data-col="2"] > .tile'); db = await dst.bounding_box()
        await pg.mouse.move(sb['x'] + 20, sb['y'] + 5); await pg.mouse.down()
        await pg.mouse.move(db['x'] + 40, db['y'] + 8, steps=12); await pg.wait_for_timeout(100)
        await shot(pg, '39_dragging')
        await pg.mouse.up(); await pg.wait_for_timeout(150)
        lay = await pg.evaluate(LAYOUT)
        check(lay['columns'][2][0] == 'accbal', 'Dragging a panel header moves it (and the layout is saved)', lay['columns'])
        # keyboard move
        await pg.focus('.tile[data-id="owe"] .tile-grip'); await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(100)
        lay = await pg.evaluate(LAYOUT)
        live = await pg.inner_text('#snap-live')
        check('owe' in lay['columns'][1] and 'Column 2' in live and await ev(pg, "document.activeElement.closest('.tile').dataset.id") == 'owe', 'Keyboard: arrow keys move a panel and announce its new position', live)
        # collapse persists
        await tool(pg, 'previnc', 'collapse'); await pg.wait_for_timeout(100)
        await pg.reload(); await pg.wait_for_selector('.tile'); await pg.wait_for_timeout(200)
        check(await ev(pg, "document.querySelector('.tile[data-id=\"previnc\"]').classList.contains('collapsed')") and await pg.query_selector('.tile[data-id="incexp"] .tile-table') is not None, 'Collapsed state and panel options survive reload')
        await tool(pg, 'previnc', 'collapse')
        # expand to full data
        await tool(pg, 'accbal', 'expand'); await pg.wait_for_selector('.modal.tile-full')
        full_rows = await ev(pg, "document.querySelectorAll('.modal.tile-full tbody tr').length")
        expect_rows = await ev(pg, "OB.ui.book.accounts.filter(a => a.active && OB.schema.isBS(a.type) && OB.ui.book.accountBalance(a.id)).length")
        check(full_rows == expect_rows and await pg.query_selector('.modal.tile-full button:has-text(\"Print\")') is not None, 'Expand shows every account (not a truncated list) with a Print option', (full_rows, expect_rows))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        # columns
        n_before = await ev(pg, "document.querySelectorAll('.tile').length")
        await pg.click('[data-cols="2"]'); await pg.wait_for_timeout(200)
        check(await ev(pg, "document.querySelectorAll('.snap-col').length") == 2 and await ev(pg, "document.querySelectorAll('.tile').length") == n_before, 'Switching to 2 columns keeps every panel')
        await pg.click('[data-cols="4"]'); await pg.wait_for_timeout(200)
        check(await ev(pg, "document.querySelectorAll('.snap-col').length") == 4, '4-column layout')
        # restore defaults
        await pg.click('#snap-reset'); await pg.wait_for_selector('.modal'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(250)
        check(await ev(pg, "[...document.querySelectorAll('.tile')].map(t => t.dataset.id).join()") == ','.join(ids), 'Restore defaults returns the original panels and positions')
        # payments + customer tabs
        await pg.click('.tabs a:has-text("Payments")'); await pg.wait_for_timeout(300)
        check(await ev(pg, "document.querySelectorAll('.tile').length") == 6 and await pg.query_selector('.tile[data-id="aging"]') is not None, 'Payments tab has its own panels')
        await shot(pg, '40_payments_tab')
        await pg.click('.tabs a:has-text("Customer")'); await pg.wait_for_timeout(300)
        await combo_pick(pg, '.snap-cust', 'Acme'); await pg.wait_for_timeout(300)
        check('Acme Corp' in await pg.inner_text('.tile[data-id="custsum"]'), 'Customer tab follows the chosen customer')
        await shot(pg, '41_customer_tab')
        check(await ev(pg, "(() => { const s = JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1')).snapshot[OB.ui.book.company.id]; return !!(s.company && s.payments && s.customer && s.customer.customerId); })()"), 'Each tab keeps its own saved layout')

        # ================= company password protection =================
        RAW = """id => new Promise((res) => { const q = indexedDB.open('OfflineBooksUS_' + id); q.onsuccess = () => { const db = q.result;
            const tx = db.transaction(['transactions', 'contacts', 'company'], 'readonly'); let out = [];
            ['transactions', 'contacts', 'company'].forEach(s => tx.objectStore(s).getAll().onsuccess = e => { out = out.concat(e.target.result); });
            tx.oncomplete = () => { db.close(); res({ n: out.length, enc: out.filter(x => x.enc).length, plain: JSON.stringify(out).includes('Acme') }); }; }; })"""
        async def unlock(pg, secret):
            await pg.fill('#ul-secret', secret); await pg.click('#ul-go')
        async def wait_dash(pg):
            await pg.wait_for_selector('.gateway, .dash', timeout=15000)
        async def save_recovery(pg):
            await pg.wait_for_selector('.modal .reckey')
            key = (await pg.inner_text('.modal .reckey')).strip()
            await pg.click('.modal .btn.primary')            # without ticking: must stay open
            await pg.wait_for_timeout(200)
            stays = await pg.query_selector('.modal .reckey') is not None
            await pg.check('#rk-ok'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(300)
            return key, stays

        co_id = await ev(pg, 'OB.ui.book.company.id')
        n_tx = await ev(pg, 'OB.ui.book.transactions.length')
        raw0 = await pg.evaluate(RAW, co_id)
        check(raw0['plain'] and raw0['enc'] == 0, 'Before protection, stored data is readable (baseline)')
        await go(pg, '#/settings?tab=security')
        await pg.fill('#on-new', 'short'); await pg.fill('#on-conf', 'short')
        await pg.click('#sec-on button[type=submit]'); await pg.wait_for_timeout(200)
        check(await ev(pg, '!OB.ui.book.security'), 'Weak password is refused')
        await pg.fill('#on-new', 'Ledger Pass 2026!'); await pg.fill('#on-conf', 'Ledger Pass 2026!')
        await pg.fill('#on-hint', 'ledger + year')
        await pg.click('#sec-on button[type=submit]')
        await pg.wait_for_selector('.modal .reckey'); await pg.wait_for_timeout(300); await shot(pg, '22_recovery_key')
        rk1, stays = await save_recovery(pg)
        check(stays, 'Recovery key dialog cannot be closed until "I have saved it" is ticked')
        check(len(rk1) == 39 and await ev(pg, '!!OB.ui.book.security'), 'Protection on; recovery key issued', rk1)
        raw1 = await pg.evaluate(RAW, co_id)
        check(raw1['enc'] == raw1['n'] and not raw1['plain'], 'All stored records are encrypted; no readable names', raw1)
        await go(pg, '#/settings?tab=security'); await shot(pg, '23_security_settings')

        # lock / unlock
        await pg.click('#btn-lock')
        await pg.wait_for_selector('#ul-form')
        await shot(pg, '24_unlock_screen')
        check(await ev(pg, 'OB.ui.book === null'), 'Lock clears the books from memory')
        await unlock(pg, 'ledger pass 2026!'); await pg.wait_for_timeout(1200)
        check('Incorrect password' in await pg.inner_text('#ul-msg'), 'Wrong password rejected')
        await pg.click('#ul-hint')
        check('ledger + year' in await pg.inner_text('#ul-msg'), 'Password hint can be shown')
        await unlock(pg, 'Ledger Pass 2026!'); await wait_dash(pg)
        await go(pg, '#/txn/new?type=journal')
        await pg.click('tr.jline:nth-child(1) .combo-input'); await pg.fill('tr.jline:nth-child(1) .combo-input', 'util'); await pg.wait_for_timeout(150)
        lst = await pg.query_selector('#combo-list')
        check(lst is not None and await lst.is_visible() and 'Utilities' in await lst.inner_text(), 'Type-to-search still works after lock and unlock')
        await pg.keyboard.press('Escape'); await discard(pg); await go(pg, '#/dashboard')
        check(await ev(pg, 'OB.ui.book.transactions.length') == n_tx, 'Correct password unlocks; all transactions present')

        # browser restart -> unlock screen
        await ctx.close()
        ctx = await p.chromium.launch_persistent_context(PROFILE, viewport={'width': 1366, 'height': 900}, accept_downloads=True)
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL)
        await pg.wait_for_selector('#ul-form', timeout=15000)
        check(await ev(pg, 'OB.ui.book === null'), 'After restarting the browser the company opens locked')
        check(await ev(pg, "document.documentElement.dataset.theme") == expect_theme and await ev(pg, "document.documentElement.dataset.density") == 'compact' and
              await ev(pg, "!!OB.prefs.table('report:gl').widths.Memo"), 'Theme, density and table layouts survive a browser restart')
        await unlock(pg, 'Ledger Pass 2026!'); await wait_dash(pg)

        # auto-lock after inactivity
        await ev(pg, 'OB.ui._setLastActivity(Date.now() - 16 * 60000)')
        await ev(pg, 'OB.ui.checkIdle()')
        await pg.wait_for_selector('#ul-form')
        check('Locked automatically after 15 minutes' in await pg.inner_text('main'), 'Auto-lock after 15 idle minutes')

        # forgot password -> recovery key -> forced new password + new recovery key
        await pg.click('#ul-mode')
        await unlock(pg, rk1.lower().replace('-', ' '))
        await pg.wait_for_selector('.modal #fp-new', timeout=15000)
        await pg.fill('#fp-new', 'Brand New Pass 77'); await pg.fill('#fp-conf', 'Brand New Pass 77')
        await pg.click('.modal .btn.primary')
        rk2, _ = await save_recovery(pg)
        check(rk2 != rk1, 'Recovery unlock forces a new password and issues a new recovery key')
        old_rk_dead = await pg.evaluate("k => OB.sec.unlock(OB.ui.book.security, k, 'recovery').then(() => false, () => true)", rk1)
        check(old_rk_dead, 'The used recovery key no longer works')
        new_pw_ok = await pg.evaluate("() => OB.sec.unlock(OB.ui.book.security, 'Brand New Pass 77').then(() => true, () => false)")
        check(new_pw_ok, 'New password works')

        # encrypted backup + restore with password
        await go(pg, '#/settings?tab=backup')
        async with pg.expect_download() as d:
            await pg.click('#bk-dl')
        dl = await d.value; ep = os.path.join(DL, dl.suggested_filename); await dl.save_as(ep)
        etxt = open(ep).read(); ebk = json.loads(etxt)
        check(ebk.get('encrypted') and 'Acme' not in etxt and 'Consulting' not in etxt and dl.suggested_filename.endswith('_protected.json'), 'Backup of a protected company is encrypted (no readable data)')
        await ev(pg, 'OB.ui.closeCompany()')
        await pg.wait_for_selector('#restore-file', state='attached')
        check('Protected' in await pg.inner_text('.company-list'), 'Company list marks the company as protected')
        await pg.set_input_files('#restore-file', ep)
        await pg.wait_for_selector('.modal #bk-sec')
        await pg.fill('#bk-sec', 'not the password'); await pg.click('.modal .btn.primary')
        await pg.wait_for_selector('.modal .banner.danger', timeout=10000)
        check('Incorrect' in await pg.inner_text('.modal'), 'Encrypted backup refuses a wrong password')
        await pg.fill('#bk-sec', 'Brand New Pass 77'); await pg.click('.modal .btn.primary')
        await pg.wait_for_selector('.modal button:has-text("Restore as a new company")', timeout=15000)
        check('stays password protected' in await pg.inner_text('.modal'), 'Restore explains the restored company stays protected')
        await pg.click('.modal button:has-text("Restore as a new company")')
        await wait_dash(pg)
        rid = await ev(pg, 'OB.ui.book.company.id')
        rraw = await pg.evaluate(RAW, rid)
        check(await ev(pg, '!!OB.ui.book.security') and rraw['enc'] == rraw['n'] and not rraw['plain'] and await ev(pg, 'OB.ui.book.transactions.length') == n_tx,
              'Restored copy is complete and stored encrypted', rraw)

        # change password, then turn protection off
        await go(pg, '#/settings?tab=security')
        await pg.fill('#ch-cur', 'Brand New Pass 77'); await pg.fill('#ch-new', 'Changed Pass 2027'); await pg.fill('#ch-conf', 'Changed Pass 2027')
        await pg.click('#sec-ch button[type=submit]'); await pg.wait_for_timeout(1500)
        changed = await pg.evaluate("() => OB.sec.unlock(OB.ui.book.security, 'Changed Pass 2027').then(() => true, () => false)")
        check(changed, 'Password changed')
        await pg.click('#sec-off'); await pg.fill('#pval', 'Changed Pass 2027'); await pg.click('.modal .btn.danger'); await pg.wait_for_timeout(1500)
        off = await pg.evaluate(RAW, rid)
        check(await ev(pg, '!OB.ui.book.security') and off['enc'] == 0 and off['plain'], 'Turning protection off decrypts the data', off)
        check(await ev(pg, "OB.ui.book.checkIntegrity().issues.length") == 0, 'Books pass integrity check after encrypt/decrypt cycles')
        audit_sec = await ev(pg, "OB.ui.book.audit.filter(a => a.action === 'security').length")
        check(audit_sec >= 3, 'Security changes recorded in the audit log', audit_sec)

        check(not errors, 'No JavaScript errors during the whole run', errors[:5])
        await ctx.close()

    shutil.rmtree(PROFILE, ignore_errors=True)
    passed = sum(1 for r in results if r[0])
    print('\n%d passed, %d failed' % (passed, len(results) - passed))
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
