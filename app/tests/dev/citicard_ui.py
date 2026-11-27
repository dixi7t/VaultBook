"""
Citi card statement import test (1.65, developer-only): the made-up Citi-style statement in tests/fixtures/statements
goes through Import bank statement (#/pdfimport) and the engine. Checks: issuer named, every line found (the payment
with only a post date included), card signs, words spaced, rewards panel and wrapped names handled, cardholder
sections, printed totals reconcile. Synthetic data only (build the PDF with make_citi_fixture.py).
Requires: Python 3 + Playwright (Chromium).
Usage: python3 citicard_ui.py /path/to/app/index.html
"""
import asyncio, os, sys, tempfile, base64
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(HERE, '..', '..', 'index.html'))
PDF = os.path.join(HERE, '..', 'fixtures', 'statements', 'citi-card-sample.pdf')
results = []
def check(cond, name, detail=''):
    results.append((bool(cond), name)); print(('  ok   ' if cond else '  FAIL ') + name + (('  [' + str(detail) + ']') if detail and not cond else ''))

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='vb_citi_'), viewport={'width': 1440, 'height': 900})
        pg = ctx.pages[0]; errors = []; pg.on('pageerror', lambda e: errors.append(str(e))); ev = pg.evaluate
        await pg.goto('file://' + APP); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Card Co'); await pg.check('#newco input[name=sample]')
        await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book'); await pg.wait_for_timeout(1200)
        await ev("location.hash = '#/pdfimport'"); await pg.wait_for_selector('#ss-file')
        await pg.set_input_files('#ss-file', PDF); await pg.click('#ss-run')
        await pg.wait_for_function("document.querySelector('#ss-results') && document.querySelector('#ss-results').textContent.includes('Citibank')", timeout=60000)
        check(True, 'Import screen reads the statement and names the issuer Citibank')

        b64 = base64.b64encode(open(PDF, 'rb').read()).decode()
        r = await ev("""async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            return OBStatement.parseAny(new File([bytes], 'citi-card-sample.pdf', { type: 'application/pdf' }), () => {}); }""", b64)
        s, t = r['summary'], r['transactions']
        got = sorted((x['dateISO'], round(x['amount'], 2)) for x in t)
        want = sorted([('2026-01-08', 500.0), ('2025-12-17', 20.0), ('2025-12-12', -18.5), ('2025-12-21', -129.95), ('2025-12-23', -46.88), ('2026-01-03', -58.12)])
        check(got == want, 'All 6 lines on the post date with card signs (payment with one date kept, year from the period)', got)
        d = {round(x['amount'], 2): x for x in t}
        check(d[-129.95]['description'] == 'ACME OFFICE SUPPLY 800-555-0101 NY', 'Words keep their spaces', d[-129.95]['description'])
        check(d[-46.88]['description'] == 'ONLINE RETA* ZZ9OD5PZ3 WWW.ONLINESHOP.COMWA', 'Wrapped merchant name joined from above and below', d[-46.88]['description'])
        check(not any('$' in x['description'] or 'period' in x['description'] or 'citicards' in x['description'] for x in t), 'No rewards panel or footer text in descriptions')
        check(d[-58.12]['section'] == 'Purchases · JORDAN SAMPLE' and d[-18.5]['section'] == 'Purchases · ALEX Q SAMPLE', 'Purchases grouped by cardholder', (d[-58.12]['section'], d[-18.5]['section']))
        check(s['beginningBalance'] == 1000 and s['endingBalance'] == 733.45 and s['statedCredits'] == 520 and s['statedDebits'] == 253.45, 'Account summary read', s)
        check(s['creditsMatch'] is True and s['debitsMatch'] is True and s['isCreditCard'] is True and s['accountNumber'].endswith('1234'), 'Totals reconcile, card account, account number', s)
        check(not errors, 'No page errors', errors)
        await ctx.close()
    bad = [n for ok, n in results if not ok]
    print(f'{len(results) - len(bad)} passed, {len(bad)} failed'); sys.exit(1 if bad else 0)

asyncio.run(main())
