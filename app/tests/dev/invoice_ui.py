"""
VaultBook invoice print layout and optional logo test (developer-only, 1.11).
Usage: python3 invoice_ui.py /path/to/app/index.html [logo.png]
A logo image is generated if none is given (no company logo ships with VaultBook).
"""
import asyncio, os, sys, tempfile
from playwright.async_api import async_playwright
APP = sys.argv[1]; URL = 'file://' + APP
results = []
def check(c, n, d=''):
    results.append((bool(c), n)); print(('  ok   ' if c else '  FAIL ') + n + (('  [' + str(d)[:200] + ']') if d and not c else ''))
async def main():
    logo = sys.argv[2] if len(sys.argv) > 2 else None
    if not logo:
        from PIL import Image, ImageDraw
        logo = os.path.join(tempfile.mkdtemp(), 'test_logo.png'); im = Image.new('RGB', (600, 120), 'white'); ImageDraw.Draw(im).rectangle([10, 10, 590, 110], outline='black', width=8); im.save(logo)
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), viewport={'width': 1300, 'height': 1000})
        pg = ctx.pages[0]; errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); ev = pg.evaluate
        await pg.goto(URL); await pg.wait_for_selector('#newco')
        await pg.fill('#newco input[name=name]', 'Print Test Co'); await pg.click('#newco button[type=submit]'); await pg.wait_for_function('OB.ui.book')
        ids = await ev("""(async () => { const b = OB.ui.book;
          await b.saveCompany({ address: '1 Main St\\nPhoenix, AZ 85001', email: 'ar@printtest.example', phone: '480-555-0100' });
          const c = await b.saveContact({ kind: 'customer', name: 'Example Hospital', address: '9 Care Rd\\nTucson, AZ 85701' });
          const s = b.accounts.find(a => a.name === 'Services').id, chk = b.accounts.find(a => a.name === 'Checking').id;
          const a = await b.saveTransaction({ type: 'invoice', date: '2026-10-08', contactId: c.id, memo: 'Billing period: September 2026', lines: [{ accountId: s, description: 'Professional interpretation', amount: '1500' }, { accountId: s, description: 'On-site visit', amount: '250.50' }] });
          const q = await b.saveTransaction({ type: 'invoice', date: '2026-10-09', contactId: c.id, lines: [{ accountId: s, description: 'License fee', qty: 3, rate: '833' }] });
          await b.saveTransaction({ type: 'payment', date: '2026-10-20', contactId: c.id, accountId: chk, amount: '1000', applications: [{ txnId: a.id, amount: '1000' }] });
          return [a.id, q.id]; })()""")
        async def show(i):
            await ev("h => location.hash = h", '#/print/' + ids[i]); await pg.wait_for_selector('[data-testid=invoice-doc] svg'); return await ev("[...document.querySelectorAll('[data-testid=invoice-doc] text')].map(x => x.textContent).join('\\n')")
        t = await show(0)
        check(not await ev("!!document.querySelector('[data-testid=invoice-doc] image')"), 'No logo on invoices by default')
        check(all(x in t for x in ['Invoice', 'Date', 'Invoice #', 'Bill To', 'Example Hospital', 'Description', 'Amount', 'Thank you for your business.', 'Total', '$1,750.50', 'Email - ar@printtest.example', 'Tel # 480-555-0100']), 'Layout: title, Date / Invoice # box, Bill To, Description / Amount, thank-you line and Total', t[:300])
        check('×' not in t and 'Balance due' in t and '750.50' in t and 'Billing period: September 2026' in t and '10/8/2026' in t, 'Simple invoice: m/d/yyyy date; memo, payments and balance due shown')
        fonts = await ev("[...new Set([...document.querySelectorAll('[data-testid=invoice-doc] text')].map(x => x.getAttribute('font-family').split(',')[0] + (x.getAttribute('font-weight') || '')))]")
        check(set(fonts) == {"'Times New Roman'", 'Arial', 'Arial700'}, 'Fonts are Times New Roman, Arial and Arial Bold, as on the reference invoice', fonts)
        import os as _os
        async with pg.expect_download() as d: await pg.click('#inv-pdf')
        dl = await d.value; pp = _os.path.join(tempfile.mkdtemp(), dl.suggested_filename); await dl.save_as(pp)
        import pdfplumber
        pz = pdfplumber.open(pp).pages[0]; names = set(c['fontname'] for c in pz.chars)
        check(names == {'TimesNewRomanPSMT', 'ArialMT', 'Arial-BoldMT'} and round(pz.width) == 612 and len(pz.lines) == 49 and not pz.images, 'Downloaded PDF: Letter page, the reference fonts, 48 box edges + email underline, no logo', (names, len(pz.lines)))
        t2 = await show(1)
        check('(3 × 833.00)' in t2 and '2,499.00' in t2 and '$2,499.00' in t2, 'Quantity × rate is shown in the description; amount column stays as on the reference')
        await ev("h => location.hash = h", '#/settings?tab=company'); await pg.wait_for_selector('[data-testid=logo-file]', state='attached')
        check('No logo' in await pg.inner_text('[data-testid=logo-card]'), 'Settings shows "No logo" until one is added')
        await pg.set_input_files('[data-testid=logo-file]', logo); await pg.wait_for_selector('.logo-preview img', timeout=10000)
        w = await ev("new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.src = OB.ui.book.company.logo; })")
        check(w <= 1200 and (await ev("OB.ui.book.company.logo")).startswith('data:image/png;base64,'), 'Added logo is stored as a PNG at most 1200 px wide', w)
        await show(0)
        check(await ev("!!document.querySelector('[data-testid=invoice-doc] image')"), 'The added logo prints on the invoice')
        async with pg.expect_download() as d: await pg.click('#inv-pdf')
        dl = await d.value; pp = _os.path.join(tempfile.mkdtemp(), dl.suggested_filename); await dl.save_as(pp)
        im = pdfplumber.open(pp).pages[0].images
        check(len(im) == 1 and abs(im[0]['x0'] - 37) < 0.1 and abs(im[0]['bottom'] - 61.0) < 0.2, 'Downloaded PDF carries the logo in the reference logo position', im[:1])
        await pg.reload(); await pg.wait_for_selector('[data-testid=invoice-doc]', timeout=15000)
        await pg.wait_for_timeout(300)
        check(await ev("!!document.querySelector('[data-testid=invoice-doc] image')"), 'Logo is kept after reload')
        await ev("h => location.hash = h", '#/settings?tab=company'); await pg.wait_for_selector('[data-testid=logo-remove]')
        await pg.click('[data-testid=logo-remove]'); await pg.click('.modal .btn.primary'); await pg.wait_for_timeout(500)
        await show(0)
        check(not await ev("!!document.querySelector('[data-testid=invoice-doc] image')") and await ev("OB.ui.book.company.logo") == '', 'Remove logo takes it off invoices')
        # select several invoices and export them for QuickBooks
        await ev("h => location.hash = h", '#/transactions'); await pg.wait_for_selector('[data-testid=iif-export]')
        await pg.click('[data-testid=iif-export]'); await pg.wait_for_selector('.modal #iif-from')
        await pg.fill('#iif-from', '2026-01-01'); await pg.dispatch_event('#iif-from', 'change'); await pg.fill('#iif-to', '2026-12-31'); await pg.dispatch_event('#iif-to', 'change')
        await pg.wait_for_timeout(200)
        check(await ev("document.querySelectorAll('.modal [data-iif]').length") == 2, 'Export dialog lists the invoices in the period')
        await pg.check('#iif-all'); await pg.wait_for_timeout(150)
        check('2 invoices selected' in await pg.inner_text('#iif-sum'), 'Select all ticks every invoice', await pg.inner_text('#iif-sum'))
        async with pg.expect_download() as d: await pg.click('.modal .btn.primary')
        dl = await d.value; ip = _os.path.join(tempfile.mkdtemp(), dl.suggested_filename); await dl.save_as(ip)
        raw = open(ip, 'rb').read(); txt = raw.decode('cp1252')
        check(dl.suggested_filename.endswith('.iif') and txt.count('\r\nTRNS\t') == 2 and txt.count('ENDTRNS\r\n') == 3 and '!CUST' in txt and '\tExample Hospital\t' in txt, 'Downloaded .iif holds both invoices, the customer and CRLF lines', dl.suggested_filename)
        # one invoice straight from its screen
        await ev("h => location.hash = h", '#/txn/' + ids[1]); await pg.wait_for_selector('[data-testid=iif-one]')
        await pg.click('[data-testid=iif-one]'); await pg.wait_for_selector('.modal #iif-sum')
        check('1 invoice selected' in await pg.inner_text('#iif-sum'), 'The invoice screen opens the export with that invoice ticked')
        await pg.click('.modal .btn:not(.primary)')
        check(not errs, 'No JavaScript errors', errs[:2])
        await ctx.close()
    f = [n for o, n in results if not o]; print('\n%d passed, %d failed' % (len(results) - len(f), len(f))); sys.exit(1 if f else 0)
asyncio.run(main())
