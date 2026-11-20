"""
VaultBook keyboard-workspace tests (developer-only, not needed to run the app).
Covers the Tally-inspired layer: Gateway menus, function-key registry and panel, command menus,
F11 Company Features, F12 Configuration, entry strip, row cursor + drill-down, Esc-back.
Requires: Python 3 + Playwright (Chromium).
Usage: python3 vaultbook_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright

APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'index.html'))
URL = 'file://' + APP
results = []

def check(cond, name, detail=''):
    results.append((bool(cond), name))
    print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_ui_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        ev = pg.evaluate
        async def key(k, wait=250): await pg.keyboard.press(k); await pg.wait_for_timeout(wait)
        async def h(): return await ev('location.hash')

        await pg.goto(URL)
        await pg.evaluate("localStorage.setItem('OfflineBooksUS.prefs.v1', JSON.stringify({ menubarSeen: true, sidebarCollapsed: false }))"); await pg.reload()   # 1.51.0: these checks use the side menu, which is now off by default
        await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Keyboard Test Co'); await pg.check('#newco input[name=sample]'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_selector('.dash', timeout=15000); await ev("location.hash = '#/gateway'")   # 1.51.0: a company opens on Home; the Gateway is under View
        await pg.wait_for_selector('.gateway', timeout=15000); await pg.wait_for_timeout(300)

        # ---- Gateway ----
        check(await h() == '#/gateway', 'Opening a company lands on the Gateway', await h())
        check('Keyboard Test Co' in await pg.inner_text('[data-testid=gateway-company]'), 'Gateway shows the company name')
        check(await ev("document.activeElement.classList.contains('gw-item')"), 'Keyboard focus starts on the Gateway menu')
        first = await ev("document.activeElement.textContent.trim()")
        await key('ArrowDown')
        check(await ev("document.activeElement.textContent.trim()") != first and await ev("document.querySelectorAll('.gw-item.on').length") == 1, 'Arrow keys move the single selection bar')
        hot = await ev("[...document.querySelectorAll('.gw-item .hot')].map(x => x.textContent.toLowerCase())")
        check(len(hot) == len(set(hot)) and len(hot) >= 10, 'Every Gateway item has a unique hot letter', hot)
        await key('v')
        check(await h() == '#/gateway?m=vouchers' and 'Invoice' in await pg.inner_text('.gw-menu'), 'Hot letter V opens the Vouchers sub-menu')
        await key('Escape')
        check(await h() == '#/gateway', 'Esc returns from a sub-menu to the Gateway', await h())
        await key('d'); await key('Escape')
        await key('t', 500)
        check((await h()).startswith('#/report/tb'), 'Hot letter T opens the Trial Balance', await h())
        # row cursor + drill-down on a report
        await key('ArrowDown'); await key('ArrowDown')
        check(await ev("document.querySelectorAll('#main tr.kb-row').length") == 1, 'Arrow keys select a report row')
        row_text = await ev("document.querySelector('#main tr.kb-row').textContent.trim().slice(0, 30)")
        tb_hash = await h()
        await key('Enter', 500)
        check(await h() != tb_hash, 'Enter drills down from the selected report row', (row_text, await h()))
        await key('Escape', 600)
        check(await h() == tb_hash, 'Esc goes back to the report', await h())
        await pg.wait_for_timeout(300)
        back_row = await ev("(document.querySelector('#main tr.kb-row') || {textContent: ''}).textContent.trim()")
        check(back_row.startswith(row_text), 'Back restores the selected report row', (row_text, back_row[:30]))

        # ---- function keys and entry windows ----
        await key('F8', 500)
        check(await h() == '#/txn/new?type=invoice', 'F8 opens a new invoice', await h())
        strip = await pg.inner_text('[data-testid=voucher-strip]')
        import datetime
        check('F5' in strip and 'Expense' in strip, 'Invoice toolbar carries the type-switch keys', strip)
        await key('F2')
        check(await ev("document.activeElement.name") == 'date', 'F2 moves to the transaction date')
        await key('Escape', 500)
        check((await h()) != '#/txn/new?type=invoice' and await pg.query_selector('.modal-backdrop') is None, 'Esc on an untouched entry closes it, even from a field')
        await key('F8', 500)
        await pg.fill('[name=memo]', 'draft'); await pg.dispatch_event('[name=memo]', 'input'); await pg.focus('[name=memo]')
        await key('Escape', 400)
        check(await pg.query_selector('.modal-backdrop') is not None and await ev("document.activeElement.textContent.trim()") == 'Save', 'Esc with unsaved changes asks: Keep editing / Discard / Save (Save focused)')
        await key('ArrowLeft', 100)
        check(await ev("document.activeElement.textContent.trim()") == 'Discard changes', 'Arrow keys move between the dialog buttons')
        await key('k', 300)
        check(await pg.query_selector('.modal-backdrop') is None and (await h()) == '#/txn/new?type=invoice', 'K keeps editing')
        await key('Escape', 400); await key('d', 600)
        check((await h()) != '#/txn/new?type=invoice', 'D discards and leaves the entry', await h())
        await key('F8', 500)
        await key('F5', 500)
        check(await h() == '#/txn/new?type=expense', 'F5 switches an empty entry to Expense', await h())
        strip = await pg.inner_text('[data-testid=voucher-strip]')
        check('No.' in strip and datetime.date.today().strftime('%A') in strip, 'Entry strip shows number and weekday', strip)
        # contact balance shown once chosen
        await pg.click('.combo:has(input[name=contactId]) .combo-input'); await pg.keyboard.type('City'); await key('Enter', 300)
        bal = await ev("[...document.querySelectorAll('.cur-bal')].map(x => x.textContent).join('|')")
        check('Current balance' in bal, 'Current balance appears under the chosen payee / account', bal)
        await pg.click('tr.line .combo-input'); await pg.fill('tr.line .combo-input', 'Meals'); await key('Enter', 150)
        await pg.fill('tr.line input[data-f=amount]', '42.50'); await pg.wait_for_timeout(150)
        await key('F9', 400)
        check(await pg.query_selector('.modal') is not None and 'Unsaved changes' in await pg.inner_text('.modal') and await h() == '#/txn/new?type=expense', 'F-key switch with unsaved entries asks first')
        await pg.click('.modal button:has-text("Keep editing")'); await pg.wait_for_timeout(150)
        check(await pg.input_value('tr.line input[data-f=amount]') == '42.50', 'Keep editing keeps the typed amount')
        n0 = await ev('OB.ui.book.transactions.length')
        await key('Control+s', 800)
        check(await ev('OB.ui.book.transactions.length') == n0 + 1, 'Ctrl+S posts the expense', n0)
        tb_ok = await ev("""(() => { const b = OB.ui.book; let d = 0, c = 0; b.accounts.forEach(a => { const v = b.rawBalance(a.id); if (v > 0) d += v; else c -= v; }); return d === c; })()""")
        check(tb_ok, 'Trial balance still balances after keyboard entry')

        # ---- panel buttons ----
        await pg.click('.fkeys [data-fk=journal]'); await pg.wait_for_timeout(400)
        check(await h() == '#/txn/new?type=journal', 'Function-key panel buttons work with the mouse', await h())
        panel = await pg.inner_text('#fkeys')
        check('F2' in panel and 'Date' in panel and 'F7' in panel, 'Panel shows actions for the current screen', panel[:120])

        # ---- registers: row cursor, open, back ----
        await ev("location.hash = '#/transactions'"); await pg.wait_for_timeout(500)
        await pg.focus('#main'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown')
        idx = await ev('OB.ui.keys.cursor.index()')
        await key('Enter', 500)
        check((await h()).startswith('#/txn/'), 'Enter opens the selected transaction', await h())
        await key('Escape', 600)
        check(await h() == '#/transactions' and await ev('OB.ui.keys.cursor.index()') == idx, 'Esc returns to the register with the same row selected', (await h(), idx))

        # ---- command menus ----
        await key('Alt+k')
        check(await ev("!document.querySelector('.cmd-menu[data-for=K]').hidden"), 'Alt+K opens the Company menu')
        await key('ArrowDown'); await key('ArrowUp'); await key('Enter', 400)
        check(await h() == '#/settings?tab=company', 'Menu item opens with Enter', await h())
        await key('Alt+g', 300)
        check(await pg.query_selector('#pal-q') is not None, 'Alt+G opens Go To')
        await key('Escape')

        # ---- F11 Company Features ----
        await ev("location.hash = '#/gateway'"); await pg.wait_for_timeout(400)
        await key('F11', 400)
        check(await pg.query_selector('.modal.cfg-window') is not None and 'Company Features' in await pg.inner_text('.modal h2'), 'F11 opens Company Features')
        await pg.select_option('select[name=useClasses]', '1'); await pg.click('.modal button:has-text("Save")'); await pg.wait_for_timeout(500)
        check(await ev('OB.ui.book.company.useClasses') is True and await ev("!document.querySelector('[data-feature=classes]').hidden"), 'F11 turns class tracking on and the menus appear')
        await ev("OB.ui.book.saveClass({ name: 'Downtown' })"); await pg.wait_for_timeout(200)
        await key('F11', 400); await pg.select_option('select[name=useClasses]', '0'); await pg.click('.modal button:has-text("Save")'); await pg.wait_for_timeout(500)
        check(await ev('OB.ui.book.company.useClasses') is False and await ev('OB.ui.book.classes.length') == 1, 'Turning a feature off keeps its data')

        # ---- F12 Configuration ----
        await key('F12', 400)
        check(await pg.query_selector('.modal.cfg-window') is not None and 'Configuration' in await pg.inner_text('.modal h2'), 'F12 opens Configuration')
        await pg.select_option('select[name=density]', 'compact'); await pg.select_option('select[name=fkeys]', '0')
        await pg.click('.modal button:has-text("Apply")'); await pg.wait_for_timeout(300)
        check(await ev("document.documentElement.dataset.density") == 'compact' and await ev("document.documentElement.classList.contains('fkeys-off')"), 'F12 applies density and hides the function-key panel')
        await pg.reload(); await pg.wait_for_selector('.gateway, #main .page', timeout=15000); await pg.wait_for_timeout(400)
        check(await ev("document.documentElement.classList.contains('fkeys-off')") and await ev("JSON.parse(localStorage.getItem('OfflineBooksUS.prefs.v1')).density") == 'compact', 'Configuration survives a reload')
        await key('F12', 400); await pg.select_option('select[name=fkeys]', '1'); await pg.click('.modal button:has-text("Apply")'); await pg.wait_for_timeout(300)
        check(not await ev("document.documentElement.classList.contains('fkeys-off')"), 'Panel can be shown again')
        await ev("location.hash = '#/report/pnl'"); await pg.wait_for_timeout(600)
        await key('F12', 400)
        check('Customize report' in await pg.inner_text('.modal'), 'F12 on a report offers that report’s own configuration')
        await key('Escape')

        # ---- F1 reference from the registry ----
        await key('F1', 400)
        txt = await pg.inner_text('.shortcuts-panel')
        check('F11' in txt and 'Features' in txt and 'Receive payment' in txt, 'F1 lists the function keys from the registry')
        await key('Escape')

        # ---- text editing is never stolen ----
        await ev("location.hash = '#/txn/new?type=journal'"); await pg.wait_for_timeout(500)
        await pg.click('textarea[name=memo]'); await pg.keyboard.type('Gk?'); await pg.wait_for_timeout(150)
        check(await pg.input_value('textarea[name=memo]') == 'Gk?' and (await h()).startswith('#/txn/new'), 'Letters and ? type normally inside fields')
        await ev("OB.ui.dirty = false")

        check(not errors, 'No JavaScript errors', errors[:3])
        await ctx.close()

    passed = sum(1 for r in results if r[0])
    print(f'\n{passed} passed, {len(results) - passed} failed')
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
