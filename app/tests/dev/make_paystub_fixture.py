"""
Builds tests/fixtures/paystub/sample-biweekly.pdf: a SCANNED (image-only) paystub PDF with made-up people and figures, laid out
like a common payroll-service stub (EARNINGS / TAXES / MISCELLANEOUS DEDUCTIONS, each with CURRENT and YTD, the stub printed
twice per page around the check). Used by payroll_ui.py to run the real offline OCR. Synthetic data only.
Usage: python3 make_paystub_fixture.py [out.pdf]
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'paystub', 'sample-biweekly.pdf')
W, H = 1836, 2376  # letter at 216 dpi
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
f = ImageFont.truetype(FONT, 24); fb = ImageFont.truetype(FONT.replace('Mono.ttf', 'Mono-Bold.ttf'), 24)
X = dict(lab1=80, cur1=440, ytd1=640, lab2=820, cur2=1010, ytd2=1170, lab3=1330, cur3=1480, ytd3=1660)
RE = dict(cur1=590, ytd1=790, cur2=1140, ytd2=1300, cur3=1600, ytd3=1780)  # right edges of the amount columns
m = lambda c: '{:,.2f}'.format(c / 100)

def stub(d, top, v):
    y = top
    t = lambda x, s, font=f: d.text((x, y), s, fill=0, font=font)
    for x, s in [(60, 'CHECK NO.'), (300, 'SOCIAL SECURITY NO.'), (620, 'EMPLOYEE NAME'), (1050, 'NUMBER'), (1380, 'STATUS'), (1640, 'DATE')]: t(x, s, fb)
    y += 40
    for x, s in [(300, 'XXX-XX-0000'), (620, v['name']), (1050, v['num']), (1380, 'Salaried'), (1640, v['date'])]: t(x, s)
    y += 44
    for x, s in [(300, 'EARNINGS'), (940, 'TAXES'), (1330, 'MISC. DEDUCTIONS')]: t(x, s, fb)
    y += 36
    for x, s in [(X['lab1'], 'TYPE'), (X['cur1'], 'CURRENT'), (X['ytd1'], 'YTD'), (X['lab2'], 'TYPE'), (X['cur2'], 'CURRENT'), (X['ytd2'], 'YTD'), (X['lab3'], 'TYPE'), (X['cur3'], 'CURRENT'), (X['ytd3'], 'YTD')]: t(x, s, fb)
    d.line((60, y + 32, W - 60, y + 32), fill=0, width=2); y += 44
    for i in range(max(len(v['earn']), len(v['tax']), len(v['ded']))):
        for sec, lab, cur, ytd in (('earn', 'lab1', 'cur1', 'ytd1'), ('tax', 'lab2', 'cur2', 'ytd2'), ('ded', 'lab3', 'cur3', 'ytd3')):
            if i < len(v[sec]):
                l = v[sec][i]; t(X[lab], l[0]); t(RE[cur] - len(m(l[1])) * 14, m(l[1])); t(RE[ytd] - len(m(l[2])) * 14, m(l[2]))
        y += 34
    y = top + 470
    d.line((60, y - 10, W - 60, y - 10), fill=0, width=2)
    e, tx, dd = v['earn'][:1], v['tax'], v['ded']
    tots = [sum(l[1] for l in e), sum(l[2] for l in e), sum(l[1] for l in tx), sum(l[2] for l in tx), sum(l[1] for l in dd), sum(l[2] for l in dd)]
    t(X['lab1'], 'TOTALS', fb)
    for (k, c) in zip(['cur1', 'ytd1', 'cur2', 'ytd2', 'cur3', 'ytd3'], tots): t(RE[k] - len(m(c)) * 14, m(c))
    y += 44
    net = tots[0] - tots[2] - tots[4]; nety = tots[1] - tots[3] - tots[5]
    t(X['lab1'], 'NET PAY', fb); t(RE['cur1'] - len(m(net)) * 14, m(net)); t(RE['ytd1'] - len(m(nety)) * 14, m(nety)); t(X['lab2'], 'Period ' + v['period'])
    return net

def person(name, num, gross, ytd_prior, fit, sit, k401, health):
    ss, med = round(gross * 0.062), round(gross * 0.0145)
    yt = lambda c: c * (ytd_prior + 1)
    return dict(name=name, num=num, date='10/16/2026', period='10/03/26-10/16/26',
        earn=[('Regular', gross, yt(gross)), ('Total Wages', gross, yt(gross))],
        tax=[('MCWH', med, yt(med)), ('SSWH', ss, yt(ss)), ('FITW', fit, yt(fit)), ('SITW', sit, yt(sit))],
        ded=[('401K', k401, yt(k401)), ('HEALTH', health, yt(health))])

PEOPLE = [person('ALEX MORGAN', '101', 384615, 20, 52300, 9615, 19231, 8500), person('JORDAN LEE', '102', 250000, 20, 27500, 6250, 0, 8500)]
pages = []
for v in PEOPLE:
    img = Image.new('L', (W, H), 255); d = ImageDraw.Draw(img)
    d.text((80, 40), 'SAMPLE PAYROLL CO (fictitious)', fill=0, font=fb)
    net = stub(d, 120, v)
    d.text((1200, 1000), v['date'], fill=0, font=f); d.text((1450, 1000), '$******' + m(net), fill=0, font=f)
    d.text((200, 1080), 'PAY TO THE ORDER OF ' + v['name'], fill=0, font=f)
    stub(d, 1400, v)
    img = img.rotate(0.25, fillcolor=255).filter(ImageFilter.GaussianBlur(0.6))  # a little scanner skew and softness
    pages.append(img.convert('RGB'))
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
pages[0].save(OUT, save_all=True, append_images=pages[1:], resolution=216)
print(OUT)
