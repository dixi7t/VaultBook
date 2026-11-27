"""VaultBook 1.58.0 — Send to QuickBooks from a date: one date, one file; what QuickBooks already has is left out.
Run: python3 tests/dev/qbfrom_ui.py"""
import asyncio, os, tempfile, json
from playwright.async_api import async_playwright
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'index.src.html')
passed = failed = 0
def check(name, ok, extra=''):
    global passed, failed
    print(('  ok   ' if ok else '  FAIL ') + name + ('' if ok else '  ' + str(extra))); passed += ok; failed += not ok
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1440, 'height': 900}, locale='en-US', accept_downloads=True)
        pg = ctx.pages[0]; ev = pg.evaluate; errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'From Co'); await pg.click('#newco button[type=submit]')
        await pg.wait_for_function("OB.ui.book && OB.ui.book.company.name === 'From Co'", timeout=30000)
        ids = await ev("""(async () => { const b = OB.ui.book, acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking');
          const ts = await b.saveTransactions([
            { type: 'expense', date: '2026-01-10', accountId: ck, lines: [{ accountId: acc('Meals'), amount: '10' }] },
            { type: 'expense', date: '2026-03-05', accountId: ck, lines: [{ accountId: acc('Meals'), amount: '20' }] },
            { type: 'deposit', date: '2026-03-06', accountId: ck, lines: [{ accountId: acc('Services'), amount: '500' }] },
            { type: 'expense', date: '2026-04-01', accountId: ck, lines: [{ accountId: acc('Meals'), amount: '30' }] }]);
          return ts.map((t) => t.id); })()""")
        await ev("location.hash = '#/qbsend?tab=date&from=2026-03-01'"); await pg.wait_for_selector('[data-testid=qs-since-table]')
        rows = await ev("[...document.querySelectorAll('[data-testid=qs-since-table] tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())")
        check('QF-01 from March 1: three bank transactions to send, January left alone', 'Bank transactions 3' in rows and 'To send 3' in rows and 'Already in QuickBooks, left out 0' in rows, rows)
        async with pg.expect_download() as dl: await pg.click('[data-testid=qs-download]')
        d = await dl.value; path = await d.path(); batch = json.load(open(path))
        check('QF-02 the file holds exactly those three, with the date in its name', len(batch['bank']) == 3 and sorted(x['date'] for x in batch['bank']) == ['2026-03-05', '2026-03-06', '2026-04-01'] and 'from-2026-03-01' in d.suggested_filename, d.suggested_filename)
        res = tempfile.mktemp(suffix='.result.json')
        json.dump({'format': 'vaultbook-qb-result', 'at': '2026-04-02T10:00:00Z', 'items': [{'key': ids[1], 'status': 'Already in QuickBooks', 'txnId': 'T-1'}, {'key': ids[2], 'status': 'Recorded', 'txnId': 'T-2'}]}, open(res, 'w'))
        await pg.set_input_files('[data-testid=qs-result]', res); await pg.wait_for_function("document.querySelector('[data-testid=qs-since-table]').innerText.includes('left out')  && /To send\\s+1/.test(document.querySelector('[data-testid=qs-since-table]').innerText)", timeout=10000)
        rows = await ev("[...document.querySelectorAll('[data-testid=qs-since-table] tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())")
        check('QF-03 after the result file, what QuickBooks has is left out and one remains', 'To send 1' in rows and 'Already in QuickBooks, left out 2' in rows, rows)
        await pg.fill('#qs-since', '2026-01-01'); await pg.keyboard.press('Enter'); await pg.wait_for_function("/To send\\s+2/.test(document.querySelector('[data-testid=qs-since-table]').innerText)", timeout=10000)
        check('QF-04 an earlier date brings January in; the choice is remembered', 'per=since' in (await ev("location.hash")) and 'from=2026-01-01' in (await ev("location.hash")) and (await ev("OB.prefs.get('qbFrom:' + OB.ui.book.company.id).from")) == '2026-01-01')
        tbl = lambda: ev("document.querySelector('[data-testid=qs-since-table]').innerText.replace(/\\s+/g, ' ')")
        await pg.select_option('#qs-per', 'day'); await pg.wait_for_function("location.hash.includes('per=day')")
        await pg.fill('#qs-since', '2026-04-01'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.includes('from=2026-04-01')"); await pg.wait_for_timeout(150)
        check('QF-07 One day sends only that day', 'To send 1' in await tbl() and not await pg.locator('#qs-until').count(), await tbl())
        await pg.select_option('#qs-per', 'custom'); await pg.wait_for_selector('#qs-until')
        await pg.fill('#qs-since', '2026-01-01'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.includes('from=2026-01-01')")
        await pg.fill('#qs-until', '2026-01-31'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.includes('to=2026-01-31')"); await pg.wait_for_timeout(150)
        check('QF-08 Custom period sends January only', 'To send 1' in await tbl() and 'Bank transactions 1' in await tbl(), await tbl())
        await pg.select_option('#qs-per', 'last12'); await pg.wait_for_selector('[data-testid=qs-range]')
        check('QF-09 Last 12 months shows its dates and needs no typing', not await pg.locator('#qs-since').count() and '–' in await pg.inner_text('[data-testid=qs-range]'))
        # straight to the QuickBooks tool: a stand-in for the tool answers on the link address
        await pg.select_option('#qs-per', 'since'); await pg.wait_for_selector('#qs-since'); await pg.fill('#qs-since', '2026-01-01'); await pg.keyboard.press('Enter'); await pg.wait_for_function("/To send\\s+2/.test(document.querySelector('[data-testid=qs-since-table]').innerText)")
        await ev("""(() => { window.__sent = []; window.fetch = (url, o) => { const body = o && o.body ? JSON.parse(o.body) : null; window.__sent.push([String(url), body]);
          let out = { ok: true };
          if (String(url).endsWith('/run')) { if (body.code !== '123456') return Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('{"ok":false,"error":"wrong link code"}') });
            const batch = JSON.parse(body.batchText); out = { format: 'vaultbook-qb-result', at: '2026-04-03T09:00:00Z', items: batch.bank.map((x, i) => ({ key: x.key, status: i ? 'Already in QuickBooks' : 'Recorded', txnId: 'L-' + i })) }; }
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(out)) }); }; })()""")
        await pg.click('[data-testid=qs-send]'); await pg.wait_for_timeout(300)
        check('QF-10 without the link code nothing is sent', await ev("window.__sent.length") == 0)
        await pg.fill('#qs-code', '123456'); await pg.click('[data-testid=qs-send]'); await pg.wait_for_function("(document.querySelector('[data-testid=qs-run]') || {}).innerText && document.querySelector('[data-testid=qs-run]').innerText.startsWith('Finished')", timeout=10000)
        sent = await ev("window.__sent.map((x) => [x[0].replace('http://127.0.0.1:47321', ''), x[1] && x[1].action, x[1] && JSON.parse(x[1].batchText || '{}').bank ? JSON.parse(x[1].batchText).bank.length : 0])")
        last = (await pg.inner_text('[data-testid=qs-run]')).replace('\n', ' ')
        check('QF-11 Send to QuickBooks now hands the two entries to the tool and reads its answer', sent == [['/hello', None, 0], ['/run', 'apply', 2]] and '1 recorded, 1 already there and skipped, 0 with problems' in last, (sent, last))
        check('QF-12 afterwards nothing is left to send', 'To send 0' in await tbl() and await pg.is_disabled('[data-testid=qs-send]'), await tbl())
        # a long send goes in parts; QuickBooks stops in the third part; Send again goes on with what is left
        await ev("""(async () => { const b = OB.ui.book, acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking'), ts = [];
          for (let i = 1; i <= 7; i++) ts.push({ type: 'expense', date: '2026-05-0' + i, accountId: ck, lines: [{ accountId: acc('Meals'), amount: String(10 + i) }] });
          await b.saveTransactions(ts); OB.qbsend.CHUNK = 2; OB.qbsend.REST_MS = 0; window.__sent = []; window.__stopAt = 3; OB.ui.render(); })()""")
        await ev("""(() => { window.fetch = (url, o) => { const body = o && o.body ? JSON.parse(o.body) : null; let out = { ok: true, version: '1.61' };
          if (String(url).endsWith('/run')) { const batch = JSON.parse(body.batchText), n = window.__sent.push([body.yes, batch.bank.length]);
            out = { format: 'vaultbook-qb-result', at: '2026-05-10T09:00:00Z', items: batch.bank.map((x, i) => n === window.__stopAt ? (i ? { key: x.key, status: 'Ready', details: 'not recorded (QuickBooks stopped before this one)' } : { key: x.key, status: 'Problem', details: 'QuickBooks stopped while this was being recorded: check in QuickBooks whether it was saved' }) : { key: x.key, status: 'Recorded', txnId: 'P-' + n + '-' + i }) }; }
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(out)) }); }; })()""")
        await pg.wait_for_function("/To send\\s+7/.test(document.querySelector('[data-testid=qs-since-table]').innerText)")
        await pg.fill('#qs-code', '123456'); await pg.click('[data-testid=qs-send]')
        await pg.wait_for_function("document.querySelector('[data-testid=qs-run]').innerText.startsWith('QuickBooks stopped')", timeout=10000)
        sent = await ev("window.__sent"); run = (await pg.inner_text('[data-testid=qs-run]')).replace('\n', ' ')
        check('QF-13 seven entries go in parts of two; the tool is told yes after the first part; the stop is reported with what was recorded', sent == [[False, 2], [True, 2], [True, 2]] and '4 recorded' in run and 'press Send again' in run, (sent, run))
        check('QF-14 what was recorded is saved; three are left and Send is ready again', 'To send 3' in await tbl() and not await pg.is_disabled('[data-testid=qs-send]'), await tbl())
        await ev("window.__stopAt = 0; window.__sent = []"); await pg.click('[data-testid=qs-send]')
        await pg.wait_for_function("document.querySelector('[data-testid=qs-run]').innerText.startsWith('Finished')", timeout=10000)
        check('QF-15 Send again finishes the rest', await ev("window.__sent") == [[False, 2], [True, 1]] and 'To send 0' in await tbl() and '3 recorded' in (await pg.inner_text('[data-testid=qs-run]')), await ev("window.__sent"))
        # 1.62: the period's bank transactions as one .iif; marked only when the user says QuickBooks imported it
        await ev("""(async () => { const b = OB.ui.book, acc = (n) => b.accounts.find((a) => a.name === n).id, ck = acc('Checking');
          await b.saveTransactions([{ type: 'expense', date: '2026-06-03', accountId: ck, memo: 'Rent \u2014 June', lines: [{ accountId: acc('Meals'), amount: '40' }] },
            { type: 'deposit', date: '2026-06-09', accountId: ck, lines: [{ accountId: acc('Services'), amount: '900' }] }]); OB.ui.render(); })()""")
        await pg.select_option('#qs-per', 'custom'); await pg.wait_for_selector('#qs-until')
        await pg.fill('#qs-since', '2026-06-01'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.includes('from=2026-06-01')")
        await pg.fill('#qs-until', '2026-06-30'); await pg.keyboard.press('Enter'); await pg.wait_for_function("location.hash.includes('to=2026-06-30')"); await pg.wait_for_timeout(150)
        check('QF-16 the .iif button counts the bank transactions of the period', (await pg.inner_text('[data-testid=qs-iif]')) == 'Download bank transactions as .iif (2)', await pg.inner_text('[data-testid=qs-iif]'))
        async with pg.expect_download() as dl: await pg.click('[data-testid=qs-iif]')
        d = await dl.value; raw = open(await d.path(), 'rb').read()
        trns = [l.split(b'\t')[2] for l in raw.split(b'\r\n') if l.startswith(b'TRNS\t')]
        check('QF-17 one .iif with both, named for the period, plain text', d.suggested_filename.endswith('-bank-2026-06-01_2026-06-30.iif') and trns == [b'CHECK', b'DEPOSIT'] and b'Rent - June' in raw and all(c < 128 for c in raw), (d.suggested_filename, trns))
        check('QF-18 it asks whether QuickBooks imported it; nothing is marked yet', await pg.locator('[data-testid=qs-iif-yes]').count() == 1 and 'To send 2' in await tbl())
        await pg.click('[data-testid=qs-iif-yes]'); await pg.wait_for_selector('[data-testid=qs-iif-ok]')
        check('QF-19 Yes marks them as in QuickBooks; they are not offered again', 'To send 0' in await tbl() and '2 bank transactions marked' in (await pg.inner_text('[data-testid=qs-iif-ask]')), await tbl())
        check('QF-05 the toolbar button opens this tab', await ev("document.querySelector('#tbar a[href=\"#/qbsend?tab=date\"]') !== null"))
        check('QF-06 no page errors', not errs, errs)
        print('\n%d passed, %d failed' % (passed, failed)); await ctx.close()
asyncio.run(main())
