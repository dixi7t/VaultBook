"""
Builds synthetic payroll documents (text PDFs, made-up company) that go with tests/fixtures/paystub/sample-biweekly.pdf:
  eftps-oct-2026.pdf   an EFTPS federal deposit confirmation for the 10/16/2026 pay date (amount = that pay date's federal liability)
  az-wh-payment.pdf    an Arizona withholding payment equal to Jordan Lee's state tax
  note.pdf             a non-payroll letter (must be recognised as not used)
Usage: python3 make_paydocs_fixtures.py [outdir]
"""
import os, sys
from reportlab.pdfgen import canvas
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'paystub')
# the two stubs in sample-biweekly.pdf (cents): gross, FIT, SIT
P = [(384615, 52300, 9615), (250000, 27500, 6250)]
ss = lambda g: round(g * 0.062); mc = lambda g: round(g * 0.0145)
fed = sum(f + 2 * ss(g) + mc(g) + mc(g) for g, f, s in P)
m = lambda c: '{:,.2f}'.format(c / 100)
def pdf(name, lines):
    c = canvas.Canvas(os.path.join(OUT, name)); y = 780
    for l in lines: c.drawString(60, y, l); y -= 18
    c.save()
pdf('eftps-oct-2026.pdf', ['Welcome To EFTPS - Payments', 'TAXPAYER NAME: SAMPLE PAYROLL CO', 'Deposit Confirmation', 'Tax Type Federal Tax Deposit',
    'Payment Amount $' + m(fed), 'Settlement Date 11/13/2026'])
pdf('az-wh-payment.pdf', ['Payment Confirmation', 'SAMPLE PAYROLL CO', 'https://www.aztaxes.gov/Home/PaymentConfirmation', 'Payment Amount', '$' + m(P[1][2]), 'Settlement Date', '11/13/2026'])
pdf('note.pdf', ['Dear customer,', 'Thank you for your order of 3 widgets on 10/02/2026. Total 125.00'])
print('federal liability', m(fed))
