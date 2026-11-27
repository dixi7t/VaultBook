"""
Builds tests/fixtures/statements/citi-card-sample.pdf: a made-up card statement laid out like a Citi business card
(Sale Date | Post Date | Description | Amount, a payment with only a post date, credits with a minus sign, one
"Standard Purchases" block per cardholder, a rewards panel beside the list, a wrapped merchant name, page footers).
Every word is drawn on its own, as the issuer's PDFs do. Synthetic names and figures only.
Usage: python3 make_citi_fixture.py [out.pdf]
"""
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'statements', 'citi-card-sample.pdf')
c = canvas.Canvas(OUT, pagesize=letter); c.setAuthor('Sample Issuer'); FS = 7.5

def words(x, y, text, size=FS):
    c.setFont('Helvetica', size)
    for w in text.split(' '):
        c.drawString(x, y, w); x += c.stringWidth(w, 'Helvetica', size) + 2.2   # a small gap, like the real files

def amount(right, y, a):
    s = ('-' if a < 0 else '') + '${:,.2f}'.format(abs(a))
    if a < 0:   # the minus is its own glyph just before the $
        w = c.stringWidth(s[1:], 'Helvetica', FS); c.setFont('Helvetica', FS); c.drawString(right - w, y, s[1:]); c.drawString(right - w - 2.7, y, '-')
    else:
        c.setFont('Helvetica', FS); c.drawRightString(right, y, s)

def footer(n):
    words(60, 30, 'www.citicards.com Customer Service 1-800-555-0100 Page %d of 2' % n); words(9, 300, '990100')

# page 1: summary
words(60, 740, 'Sample Rewards Visa Business Card by Citi', 11)
words(60, 720, 'ALEX Q SAMPLE'); words(60, 708, 'SAMPLE TRADING LLC')
words(60, 690, 'Account number ending in: 1234   Billing Period: 12/11/25-01/12/26')
words(60, 670, 'New balance as of 01/12/26: $733.45   Minimum payment due: $41.00')
y = 640
for lab, val in [('Previous balance', '$1,000.00'), ('Payments', '-$500.00'), ('Credits', '-$20.00'), ('Purchases', '+$253.45'),
                 ('Cash advances', '+$0.00'), ('Fees', '+$0.00'), ('Interest', '+$0.00'), ('New balance', '$733.45')]:
    words(330, y, lab); c.drawRightString(540, y, val); y -= 12
words(330, y - 8, 'Credit limit $10,000')
footer(1); c.showPage()

# page 2: activity
words(63, 720, 'Sale Post'); words(63, 711, 'Date Date'); words(129.8, 711, 'Description'); words(358.8, 711, 'Amount')
words(415.9, 709, 'Rewards Summary', 9)
words(63, 690, 'Payments, Credits and Adjustments', 9); words(415.9, 692, 'Rewards balance as of')
words(415.9, 682, 'last statement ....................... +$12.00')
rows = [(None, '01/08', 'AUTOPAY 000111222333RAUTOPAY AUTO-PMT', -500.00),
        ('12/17', '12/17', 'SAMPLE HARDWARE #0101 SPRINGFIELD NJ', -20.00)]
y = 676
for sd, pd, d, a in rows:
    if sd: words(63.1, y, sd)
    words(93.8, y, pd); words(129.8, y, d); amount(387.4, y, a); y -= 12.3
words(415.9, 668, 'Earned this period ............... +$5.07')
holders = [('ALEX Q SAMPLE', [('12/12', '12/12', 'MAPLE CAFE HOBOKEN NJ', 18.50), ('12/20', '12/21', 'ACME OFFICE SUPPLY 800-555-0101 NY', 129.95)]),
           ('JORDAN SAMPLE', [('12/23', '12/23', '', 46.88), ('01/02', '01/03', 'RIVER FUEL #22 TRENTON NJ', 58.12)])]
y -= 10
for name, txns in holders:
    words(63, y, name); y -= 11; words(63, y, 'Standard Purchases', 9); y -= 13
    for sd, pd, d, a in txns:
        if not d:   # wrapped: first part above the dates, the rest below
            words(129.8, y + 5, 'ONLINE RETA* ZZ9OD5PZ3'); words(63.1, y - 1, sd); words(93.8, y - 1, pd); amount(387.4, y - 1, a)
            words(129.8, y - 7, 'WWW.ONLINESHOP.COMWA'); y -= 20; continue
        words(63.1, y, sd); words(93.8, y, pd); words(129.8, y, d); amount(387.4, y, a); y -= 12.3
words(60, y - 20, '2026 totals year-to-date'); words(60, y - 40, 'Interest charge calculation')
footer(2); c.save(); print('wrote', OUT)
