"""
Standalone Paystub to QuickBooks IIF tool (developer-only): builds it, opens it offline, reads the synthetic scanned paystub
(tests/fixtures/paystub/sample-biweekly.pdf, made-up people) with the real OCR, checks the entry, renames an account, downloads
the .iif and checks it: account rows parents first, balanced GENERAL JOURNAL, memo with frequency/period, CRLF.
Usage: python3 paystub_iif_ui.py
"""
import asyncio, os, subprocess, sys, tempfile
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.abspath(os.path.join(HERE, '..', '..'))
PDF = os.path.join(APP, 'tests', 'fixtures', 'paystub', 'sample-biweekly.pdf')
OUT = os.path.join(tempfile.mkdtemp(prefix='vb_iif_'), 'PaystubToIIF.html')
subprocess.run([sys.executable, os.path.join(APP, 'tools', 'paystub-iif', 'build.py'), OUT], check=True)
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(accept_downloads=True); pg = await ctx.new_page()
        errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        await ctx.route('http*://**', lambda r: r.abort())   # proves it works with no network
        await pg.goto('file://' + OUT); await pg.wait_for_selector('#drop')
        check(await pg.is_disabled('#download'), 'Download is off until a paystub is read')
        check(await pg.locator('#map input[data-name]').count() == 15, 'Account mapping lists all 15 parts of a paycheck')
        await pg.fill('#suta-r', '2.0'); await pg.dispatch_event('#suta-r', 'change'); await pg.fill('#suta-b', '8000'); await pg.dispatch_event('#suta-b', 'change')
        await pg.fill('[data-name=net]', 'Checking'); await pg.dispatch_event('[data-name=net]', 'change'); await pg.select_option('[data-type=net]', 'BANK')
        await pg.set_input_files('#file', PDF)
        await pg.wait_for_function("document.querySelectorAll('.stub').length >= 2 && !document.querySelector('.spin')", timeout=300000)
        st = await pg.inner_text('#status')
        check('2 stubs (OCR)' in st, 'Scanned PDF read with offline OCR, no network', st)
        g = await pg.inner_text('#groups')
        check('bi-weekly' in g and 'Ready' in g and g.count('Every figure ties') == 2, 'Both stubs tie; bi-weekly; ready', g[:300])
        check(not await pg.is_disabled('#download'), 'Download enabled')
        # other payroll documents: recognised, used or not, cross-checked
        FX = os.path.join(APP, 'tests', 'fixtures', 'paystub')
        await pg.set_input_files('#file', [os.path.join(FX, n) for n in ('eftps-oct-2026.pdf', 'az-wh-payment.pdf', 'note.pdf')])
        await pg.wait_for_function("!document.querySelector('.spin') && document.querySelector('#crosscheck') && !document.querySelector('#crosscheck').hidden && /not used|Not used/i.test(document.querySelector('#cc-body').innerText)", timeout=120000)
        cc = await pg.inner_text('#crosscheck')
        check('Federal tax deposit (EFTPS)' in cc and 'State withholding payment' in cc and 'Not used' in cc, 'Documents recognised: EFTPS deposit, state payment, a letter not used', cc[:400])
        check('0 differ' in await pg.inner_text('#cc-count'), 'Nothing differs', await pg.inner_text('#cc-count'))
        check('$1,768.96' in cc and 'deposit' in cc.lower(), 'EFTPS deposit equals the pay date\'s federal liability (1,768.96)')
        check('Jordan Lee' in cc and 'AZ' in cc, 'Arizona payment matched to Jordan Lee\'s state tax')
        async with pg.expect_download() as d:
            await pg.click('#download')
        dl = await d.value; path = await dl.path(); raw = open(path, 'rb').read(); txt = raw.decode('utf-8')
        check(dl.suggested_filename == 'Payroll JE 2026-10-16.iif', 'File named after the pay date', dl.suggested_filename)
        check(b'\r\n' in raw and b'\n' not in raw.replace(b'\r\n', b''), 'CRLF line ends')
        rows = [r.split('\t') for r in txt.split('\r\n') if r]
        acc = [(r[1], r[2]) for r in rows if r[0] == 'ACCNT']
        names = [a[0] for a in acc]
        check(names.index('Payroll Liabilities') < names.index('Payroll Liabilities:Federal Withholding') and ('Checking', 'BANK') in acc and ('Payroll Expenses:Wages', 'EXP') in acc, 'Accounts created, parents first, net pay to the bank', acc)
        tx = [r for r in rows if r[0] in ('TRNS', 'SPL')]
        check(tx[0][0] == 'TRNS' and all(r[2] == 'GENERAL JOURNAL' and r[3] == '10/16/2026' and r[7] == 'PR101626' for r in tx) and all(len(r[7]) <= 11 for r in tx), 'One GENERAL JOURNAL dated 10/16/2026, number PR101626 (QuickBooks max 11 characters)')
        check(sum(round(float(r[6]) * 100) for r in tx) == 0, 'Debits = credits')
        check(all(c < 128 for c in raw), 'ASCII only'); check('bi-weekly' in tx[0][8] and '10/03/2026 - 10/16/2026' in tx[0][8] and tx[0][8].endswith('Gross wages'), 'First line memo carries frequency, period and the line', tx[0][8])
        check(any(r[4] == 'Checking' and r[8] == 'Alex Morgan - Net pay' and r[6] == '-2655.46' for r in tx), 'Alex Morgan net pay 2,655.46 credited to Checking')
        # without creating accounts
        await pg.uncheck('#create')
        async with pg.expect_download() as d2:
            await pg.click('#download')
        t2 = open(await (await d2.value).path()).read()
        check('!ACCNT' not in t2 and '!TRNS' in t2, 'Unticked: no account rows, entry only')
        # combined entry: move Jordan Lee to a second pay date, then merge both pay dates into one entry
        await pg.check('#create')
        await pg.fill('.stub:nth-of-type(2) input[type=date]', '2026-10-30'); await pg.evaluate("document.activeElement.blur()")
        await pg.wait_for_function("document.querySelectorAll('#groups > section').length === 2")
        await pg.select_option('#merge', '1'); await pg.wait_for_selector('#combined')
        check('2 pay dates' in await pg.inner_text('#combined'), 'Combined entry preview for 2 pay dates')
        async with pg.expect_download() as d3:
            await pg.click('#download')
        dl3 = await d3.value; rows3 = [r.split('\t') for r in open(await dl3.path(), newline='').read().split('\r\n') if r]
        tx3 = [r for r in rows3 if r[0] in ('TRNS', 'SPL')]
        check(sum(1 for r in rows3 if r[0] == 'TRNS') == 1 and sum(1 for r in rows3 if r[0] == 'ENDTRNS') == 1 and sum(round(float(r[6]) * 100) for r in tx3) == 0, 'Combined: one balanced journal entry in the .iif')
        check(tx3[0][3] == '10/30/2026' and tx3[0][7] == 'PR103026' and 'combined' in tx3[0][8] and dl3.suggested_filename.endswith('combined.iif'), 'Dated the last pay date; memo says combined', (tx3[0][3], tx3[0][7], tx3[0][8][:90], dl3.suggested_filename))
        await pg.select_option('#merge', '')
        await pg.uncheck('#create')
        # settings remembered on reload
        await pg.reload(); await pg.wait_for_selector('#map input')
        check(await pg.input_value('[data-name=net]') == 'Checking' and await pg.input_value('#suta-r') == '2.0' and not await pg.is_checked('#create'), 'Mapping and settings remembered in this browser')
        check(not errors, 'No page errors', errors)
        await br.close()
    bad = [n for ok, n in results if not ok]; print(f"\n{len(results) - len(bad)}/{len(results)} passed"); sys.exit(1 if bad else 0)
asyncio.run(main())
