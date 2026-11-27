/* Statement Studio engine, blended into OfflineBooks US. Parses PDF / QBO / OFX / spreadsheet statements locally. */

/* ==========================================================================
   Bank Statement -> Excel Extractor
   All processing happens locally in the browser. Nothing is uploaded anywhere.
   ========================================================================== */

(function () {
  'use strict';

  // ---- Wire up the bundled pdf.js worker from the inlined script tag -----
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([window.__OB_PDF_WORKER_SRC__], { type: 'application/javascript' }));

  // ==========================================================================
  // 1. PDF -> ROWS (position aware text reconstruction)
  // ==========================================================================

  async function extractRows(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const rows = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .map((it) => ({
          text: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width || 0,
        }))
        .filter((it) => it.text.trim().length > 0);
      // Filled-in form fields (e.g. a state tax return typed into a PDF form) are not in the text layer: add their values
      // where they sit on the page, on the baseline of the line they fill.
      try {
        for (const an of await page.getAnnotations()) {
          const v = an && an.subtype === 'Widget' && typeof an.fieldValue === 'string' ? an.fieldValue.trim() : '';
          if (!v || !an.rect || an.checkBox || an.radioButton) continue;
          items.push({ text: v, x: an.rect[0] + 1, y: an.rect[1] + (an.rect[3] - an.rect[1]) * 0.22, width: an.rect[2] - an.rect[0] });
        }
      } catch (e) { /* no annotations: text layer only */ }

      // Sort top-to-bottom (PDF y grows upward), then left-to-right.
      items.sort((a, b) => b.y - a.y || a.x - b.x);

      let current = null;
      for (const it of items) {
        if (!current || Math.abs(current.y - it.y) > 2.6) {
          current = { y: it.y, page: p, items: [] };
          rows.push(current);
        }
        current.items.push(it);
      }
    }

    // Re-sort items within each row left-to-right, drop "fake bold" stacked
    // duplicate glyphs (same text re-stamped at ~the same x to simulate bold
    // without a bold font), then build a plain-text view using gap-aware
    // spacing (some PDFs fragment words into multiple text-show operators
    // with tiny/no real gap between them, which naive "join with space"
    // would incorrectly split, e.g. "T" + "otal" -> "Total").
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);

      const deduped = [];
      for (const it of row.items) {
        const prev = deduped[deduped.length - 1];
        if (prev && prev.text === it.text && Math.abs(prev.x - it.x) < 2) {
          continue; // duplicate "bold" stamp, skip
        }
        deduped.push(it);
      }

      // Merge adjacent glyph-runs that have (near-)zero gap between them into
      // a single token. Some PDFs split a single visual word/number across
      // multiple text-show operators (e.g. "1" + "1,120.42" -> "11,120.42"),
      // which would otherwise silently corrupt amount parsing.
      row.raw = deduped.map((i) => ({ text: i.text, x: i.x, width: i.width }));
      const merged = [];
      for (const it of deduped) {
        const prev = merged[merged.length - 1];
        if (prev) {
          const prevEndX = prev.x + (prev.width || prev.text.length * 3.5);
          const avgCharWidth = it.width && it.text.length ? it.width / it.text.length : 3.5;
          const gap = it.x - prevEndX;
          if (gap <= avgCharWidth * 0.85 && gap <= 2.2) {
            prev.text += it.text;
            prev.width = it.x + it.width - prev.x;
            continue;
          }
        }
        merged.push({ text: it.text, x: it.x, y: it.y, width: it.width });
      }
      row.items = merged;

      // Some statements carry hidden/overlapping tracking-code text (from a
      // barcode graphic's underlying content stream, or a page-footer batch
      // ID rendered at the wrong position) that lands glued onto the front
      // of otherwise-real content with no separating space — e.g.
      // "0002-0003Mar 06" instead of "Mar 06". Strip that specific shape
      // (a run of digit-groups separated by spaces/dashes) from the start
      // of an item only when it's immediately followed by a letter, since a
      // standalone tracking-code item on its own line is harmless and left
      // alone.
      const TRACKING_CODE_PREFIX_RE = /^\d{5,9}(?:[\s\-]\d{3,9}){1,3}(?=[A-Za-z])/;
      for (const it of row.items) {
        const stripped = it.text.replace(TRACKING_CODE_PREFIX_RE, '');
        if (stripped !== it.text && stripped.length > 0) {
          const removedLen = it.text.length - stripped.length;
          const avgCharWidth = it.width && it.text.length ? it.width / it.text.length : 3.5;
          it.x += removedLen * avgCharWidth;
          it.width = Math.max(0, it.width - removedLen * avgCharWidth);
          it.text = stripped;
        }
      }
      row.text = row.items
        .map((i) => i.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return rows.filter((r) => r.text.length > 0);
  }

  // ==========================================================================
  // 2. HELPERS: number / date parsing
  // ==========================================================================

  const AMOUNT_RE = /^\(?-?\$?[\d,]*\.\d{2}\)?-?$/;
  const DATE_START_RE = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;

  // Some PDFs render a leading "-" or "$" as its own glyph with a visible gap
  // before the digits (e.g. the literal text run "- 1,218.71"). Collapse
  // internal whitespace around sign/currency markers before testing/parsing
  // so these are still recognized as a single amount.
  function normalizeAmountText(text) {
    let t = text.trim().replace(/([\-\$(])\s+/g, '$1').replace(/\s+([)\-])/g, '$1');
    // Trailing footnote-reference glyphs some issuers glue directly onto an
    // amount with no space (e.g. "$32.46⧫" to mark "Pay Over Time activity",
    // or "$1.23*" for a plain asterisk footnote).
    t = t.replace(/[⧫♦◆†‡*]+$/, '');
    return t;
  }

  function isAmountToken(text) {
    const t = normalizeAmountText(text);
    return AMOUNT_RE.test(t);
  }

  // True when the raw token itself carries an explicit negative sign (a
  // leading/trailing "-", or parentheses) rather than being a bare positive
  // number. This matters because some statements print credits and debits
  // in a single shared "Credits/Debits" column, distinguished only by this
  // sign — for those, the token's own sign is definitive and must not be
  // overridden by which column it structurally landed in, or by a guessed
  // section-level sign.
  function tokenHasExplicitSign(text) {
    const t = normalizeAmountText(text);
    return t.startsWith('-') || t.endsWith('-') || (t.startsWith('(') && t.endsWith(')'));
  }

  function parseAmount(text) {
    let t = normalizeAmountText(text);
    let neg = false;
    if (t.startsWith('(') || t.endsWith(')')) {
      neg = true;
      t = t.replace(/[()]/g, '');
    }
    if (t.startsWith('-')) {
      neg = true;
      t = t.slice(1);
    }
    if (t.endsWith('-')) {
      neg = true;
      t = t.slice(0, -1);
    }
    t = t.replace(/\$/g, '').replace(/,/g, '');
    let val = parseFloat(t);
    if (isNaN(val)) return null;
    if (neg) val = -Math.abs(val);
    return val;
  }

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };

  // Many bank statements lay text out in two side-by-side columns (e.g. a
  // mailing address on the left and "Page X of Y" info on the right, or a
  // "Beginning Balance" box next to an unrelated "Average Balance" box) that
  // our y-based row grouping merges into a single logical row. Splitting on
  // large horizontal gaps recovers the individual columns so label/value
  // matching doesn't leak across them.
  function splitColumns(row, gapThreshold = 15) {
    const cols = [[]];
    let prevEndX = null;
    for (const it of row.items) {
      if (prevEndX !== null && it.x - prevEndX > gapThreshold) {
        cols.push([]);
      }
      cols[cols.length - 1].push(it);
      prevEndX = it.x + (it.width || it.text.length * 3.5);
    }
    return cols;
  }

  function itemsText(items) {
    return items
      .map((i) => i.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lastAmountInItems(items) {
    const nums = items.filter((it) => isAmountToken(it.text));
    if (!nums.length) return null;
    return parseAmount(nums[nums.length - 1].text);
  }

  function findAllDatesInText(text) {
    // Matches "December 1, 2025", "Jan 31 2025", "Feb 01 2026" etc.
    const re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const mon = MONTHS[m[1].toLowerCase()];
      if (!mon) continue;
      out.push({ y: parseInt(m[3], 10), m: mon, d: parseInt(m[2], 10), index: m.index });
    }
    return out;
  }

  function findSlashDatesInText(text) {
    // Matches "05/29/2026", "2/28/26"
    const re = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      let y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      out.push({ y, m: parseInt(m[1], 10), d: parseInt(m[2], 10), index: m.index });
    }
    return out;
  }

  function toISO(y, m, d) {
    return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d
      .toString()
      .padStart(2, '0')}`;
  }

  // ==========================================================================
  // 3. STATEMENT METADATA EXTRACTION
  // ==========================================================================

  const BANK_SIGNATURES = [
    { name: 'American Express', re: /american express|\bamex\b/i },
    { name: 'OceanFirst', re: /oceanfirst/i },
    { name: 'Bank of America', re: /bank of america/i },
    { name: 'TD Bank', re: /\btd bank\b/i },
    { name: 'Wells Fargo', re: /wells fargo/i },
    { name: 'Chase', re: /\bchase\b|jpmorgan chase/i },
    { name: 'ConnectOne Bank', re: /connectone\s*bank/i },
    { name: 'Citizens Bank', re: /\bcitizens\b/i },
    { name: 'Citibank', re: /citibank|citi\s*business|citicards\.com|\bby\s+citi\b/i },
    { name: 'US Bank', re: /\bu\.?s\.?\s*bank\b(?!\s+(and|or|,))/i },
    { name: 'PNC Bank', re: /\bpnc\b/i },
    { name: 'Capital One', re: /capital one/i },
    { name: 'Truist', re: /\btruist\b/i },
    { name: 'Regions Bank', re: /regions bank/i },
    { name: 'Southern Bank', re: /southern bank/i },
    { name: 'Hanover Bank', re: /hanover\s*bank/i },
    { name: 'Community Bank', re: /\bcommunity\s*bank\b/i },
  ];

  // Exposed for the UI's (deliberately unadvertised) "supported banks"
  // panel. Named recognition is a labeling/display convenience, not a
  // requirement for extraction to work — every one of these banks would
  // still parse correctly as "Unknown Bank" via pure structural detection;
  // this list only controls whether the name gets shown automatically.
  function listNamedBanks() {
    return BANK_SIGNATURES.map((s) => s.name).slice().sort();
  }

  function detectBank(fullText) {
    for (const sig of BANK_SIGNATURES) {
      if (sig.re.test(fullText)) return sig.name;
    }
    return 'Unknown Bank';
  }

  // Last resort when the bank's own name never appears in the extractable
  // text layer at all — some statements render their logo, and even their
  // entire "customer service" info box, as a rasterized image rather than
  // real text, leaving no text signal to search. People very commonly name
  // downloaded statement files after the bank ("Hanover-Statement-March-
  // 2026.pdf"), so the filename is a reasonable, honestly-labeled fallback
  // rather than leaving the statement as "Unknown Bank".
  function splitLetterDigitBoundaries(text) {
    return text.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2');
  }

  function guessBankFromFilename(fileName) {
    let cleaned = splitLetterDigitBoundaries(fileName)
      .replace(/\.\w{2,4}$/i, '')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\b(bank\s*)?(e?statement|stmt|activity)s?\b/gi, ' ')
      .replace(/\b(account|acct|no\.?|number)\b/gi, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ')
      .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length < 3) return null;
    if (cleaned.length > 40) cleaned = cleaned.slice(0, 40).trim();
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function detectAccountNumber(fullText) {
    const patterns = [
      /account\s*number[:\s#]*([0-9xX\s\-]{4,24}\d)/i,
      /account\s*#\s*[:\s]*([0-9xX\s\-]{4,24}\d)/i,
      /primary account\s*#[:\s]*([0-9xX\s\-]{4,24}\d)/i,
      /Account\s*number\s*[:\s]*(\d[\d\s]{3,20}\d)/i,
      // Masked account numbers ("XXXXXX-180-5", "XXXX1234"): a run of masking
      // X's/asterisks immediately followed by the visible digit suffix, in
      // whatever surrounding wording the bank uses.
      /\b([X*]{4,}[-\s]?\d[\d\-]{0,10})\b/,
      // "...ending 1234" / "...ending in 1234" style, no masking characters.
      /ending\s*(?:in\s*)?[:#]?\s*(\d[\d\-]{1,8}\d)\b/i,
    ];
    for (const p of patterns) {
      const m = fullText.match(p);
      if (m) return m[1].trim().replace(/\s+/g, ' ');
    }
    return '';
  }

  const BOILERPLATE_NAME_RE = /(statement of account|account summary|checking summary|customer service|questions\?|page \d|deposit accounts|important|business advantage|convenience plus|commercial basic|small business checking|checking account|daily account activity|preferred rewards|bank of america|wells fargo|td bank|jpmorgan chase|^chase$|connectone|p\.?o\.?\s*box|n\.?a\.?$|member fdic|equal housing)/i;

  // Bank return-address blocks often carry short branch/routing codes
  // ("US002 | BR336", "ROP 450") right above their own street line — these
  // structurally look exactly like a name candidate (short, all caps, no
  // leading digit) but aren't one.
  function looksLikeBranchCode(text) {
    const t = text.trim();
    return /^[A-Z]{2,6}\s*\d{2,6}(\s*[|\/]\s*[A-Z]{2,6}\s*\d{0,6})?$/.test(t);
  }

  function looksLikeName(t, bank) {
    if (!t || t.length < 3 || t.length > 60) return false;
    if (BOILERPLATE_NAME_RE.test(t)) return false;
    if (looksLikeBranchCode(t)) return false;
    if (/^\d/.test(t)) return false;
    if (bank) {
      const nb = normalizeLabel(bank);
      const nt = normalizeLabel(t);
      if (nb && nt && (nt.includes(nb) || nb.includes(nt))) return false;
    }
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) return false;
    const upperRatio = (t.match(/[A-Z]/g) || []).length / letters.length;
    return upperRatio > 0.8;
  }

  // Some statements carry a decorative barcode/PDF417 graphic whose
  // underlying content stream leaks nonsense "text" into the extractable
  // layer right alongside the real address block (e.g.
  // "AKFMDNBKFLGPBMGPCNFOGK 341 S BLACK HORSE PIKE STE B" — the first
  // "word" is barcode noise, the rest is the real street line). Real
  // English words/names — even acronyms like "LLC" or "STE" — have a
  // plausible vowel ratio; this kind of noise essentially never does.
  // Filtering it at the token level (rather than rejecting the whole line)
  // keeps the genuine address text usable.
  function isNoiseToken(word) {
    if (word.length < 8 || !/^[A-Z]+$/.test(word)) return false;
    const vowels = (word.match(/[AEIOU]/g) || []).length;
    return vowels / word.length < 0.2;
  }

  function stripNoiseTokens(text) {
    return text
      .split(/\s+/)
      .filter((w) => !isNoiseToken(w))
      .join(' ')
      .trim();
  }

  const CARD_NUMBER_LINE_RE = /^[\dXx*\s]{12,24}$/;

  function detectAccountHolder(fullText, rows, bank) {
    const leftCol0 = (row) => stripNoiseTokens(itemsText(splitColumns(row)[0]));

    // Credit card statements commonly lead with: Name / masked card number
    // / statement date range, right at the top of page 1 — a distinctive,
    // reliable anchor that should take priority over the general
    // zip-anchored address search below. That search can otherwise land on
    // the bank's own remittance address (e.g. "BUSINESS CARD / PO BOX...")
    // if it happens to appear earlier in the document than the true
    // customer address block.
    for (let i = 0; i < Math.min(rows.length, 15) - 2; i++) {
      const nameCand = leftCol0(rows[i]);
      const cardLine = leftCol0(rows[i + 1]);
      const digitCount = (cardLine.match(/\d/g) || []).length;
      if (
        looksLikeName(nameCand, bank) &&
        CARD_NUMBER_LINE_RE.test(cardLine) &&
        digitCount >= 12 &&
        /\b[A-Za-z]+\s+\d{1,2},?\s*\d{4}\b/.test(leftCol0(rows[i + 2]) || '')
      ) {
        return nameCand;
      }
    }

    // Primary strategy: mailing-address blocks in bank statements always end
    // with a "CITY, ST ZIP" line. The account holder's name is the nearest
    // name-like line above that address block. Only look at the left-hand
    // column of each row, since the address block is frequently merged (by
    // shared y-position) with unrelated right-column text. A document can
    // contain several such blocks (the bank's own return address, a
    // "remit to" address, the actual customer) — keep scanning past any
    // block whose name candidate turns out to be the bank itself or a
    // branch code rather than giving up at the first match.
    const zipRe = /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/;
    const streetRe = /^\d+\s+[A-Za-z]|^p\.?\s*o\.?\s*box\b/i;

    const leftCol = (row) => stripNoiseTokens(itemsText(splitColumns(row)[0]));

    for (let i = 0; i < Math.min(rows.length, 120); i++) {
      const t = leftCol(rows[i]);
      if (!zipRe.test(t)) continue;
      for (let j = i; j >= Math.max(0, i - 4); j--) {
        if (streetRe.test(leftCol(rows[j])) || j === i) {
          // Prefer the topmost name-like line in the small window above the
          // street line (a company name usually leads; a contact person's
          // name, if present, follows directly beneath it).
          for (let k = Math.max(0, j - 3); k < j; k++) {
            const cand = leftCol(rows[k]);
            if (looksLikeName(cand, bank)) return cand;
          }
        }
      }
    }

    // Fallback: scan the first ~60 rows (left column only) for a name-like line.
    for (let i = 0; i < Math.min(rows.length, 60); i++) {
      const t = leftCol(rows[i]);
      if (looksLikeName(t, bank)) return t;
    }
    return '';
  }

  function detectStatementPeriod(fullText) {
    // Match across reconstructed-row boundaries: treat newlines as spaces.
    const flat = fullText.replace(/\s+/g, ' ');

    const patterns = [
      /for\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
      /([A-Za-z]+\s+\d{1,2},?\s*\d{4})\s+through\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
      /statement period[:\s]*([A-Za-z]{3,9}\.?\s+\d{1,2}\s*,?\s*\d{4})\s*[-–to]{1,4}\s*([A-Za-z]{3,9}\.?\s+\d{1,2}\s*,?\s*\d{4})/i,
      /([A-Za-z]+\s+\d{1,2},?\s*\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
      // Numeric slash-date ranges: "For the Period 02/28/2026 to 03/31/2026"
      // and similar generic "MM/DD/YYYY to/thru/- MM/DD/YYYY" phrasing.
      /for\s+the\s+period\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(?:to|thru|through)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/,
    ];
    for (const p of patterns) {
      const m = flat.match(p);
      if (m && m[1] && m[2]) {
        return { text: `${m[1]} to ${m[2]}`.replace(/\s+/g, ' '), raw: m[0] };
      }
    }
    // "Last statement: X / This statement: Y" style (e.g. ConnectOne)
    const m2 = flat.match(/last statement[:\s]*([A-Za-z]+\s+\d{1,2},\s*\d{4}).{0,60}?this statement[:\s]*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
    if (m2) return { text: `${m2[1]} to ${m2[2]}`, raw: m2[0] };

    // "Beginning Balance as of MM/DD/YYYY ... Ending Balance as of
    // MM/DD/YYYY" — some statements (e.g. Hanover) never print a clean
    // "Statement Date ... to ... Date" range at all; the account-summary
    // box's own beginning/ending balance lines are the only place the true
    // period start and end dates appear.
    const m4 = flat.match(/(?:beginning|previous|opening)\s+balance\s+as\s+of\s+(\d{1,2}\/\d{1,2}\/\d{2,4}).{0,200}?(?:ending|current|closing)\s+balance\s+as\s+of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m4) return { text: `${m4[1]} to ${m4[2]}`, raw: m4[0] };

    // Single date near top (e.g. "January 31, 2025  Page 1 of 4")
    const m3 = flat.match(/([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*(?:■|\||Page)/i);
    if (m3) return { text: m3[1], raw: m3[0], singleDate: true };

    // "Closing Date MM/DD/YY" — credit card statements (e.g. Amex) that
    // print only the closing date, never an explicit period range. The
    // true start of the billing period is derived from the earliest real
    // transaction date instead (see deriveQboMetadata's fallback).
    const m5 = flat.match(/closing date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (m5) return { text: m5[1], raw: m5[0], singleDate: true };

    return { text: '', raw: '' };
  }

  function periodToRange(period) {
    // Returns {start:{y,m,d}, end:{y,m,d}} or nulls
    if (!period || !period.text) return { start: null, end: null };
    let dates = findAllDatesInText(period.text);
    if (!dates.length) dates = findSlashDatesInText(period.text);
    if (dates.length >= 2) return { start: dates[0], end: dates[dates.length - 1] };
    if (dates.length === 1) {
      const end = dates[0];
      // assume ~1 month statement, start = previous month, same day+1
      let sm = end.m - 1, sy = end.y;
      if (sm < 1) { sm = 12; sy -= 1; }
      return { start: { y: sy, m: sm, d: end.d }, end };
    }
    return { start: null, end: null };
  }

  // Labels seen in the "account summary" box at the top of a statement,
  // before the itemized transaction tables begin.
  const BEGIN_BAL_RE = /(beginning|previous|opening)\s+(ledger\s+)?balance/i;
  const END_BAL_RE = /(ending|current|closing|new)\s+balance/i;
  const CREDIT_LABEL_RE = /(deposits?\s*(and|\/)?\s*(other\s*)?(credits|additions)\b|total deposits\b|electronic\s+(deposits|credits|additions)\b|other credits\b|total additions\b|^credits\b|^deposits\b|payments?\s*(and\s*other\s*)?credits?\b|credit\(?s\)?\s+this\s+period\b)/i;
  const DEBIT_LABEL_RE = /(withdrawals?\s*(and|\/)?\s*(other\s*)?debits\b|checks?\s*(and|\/)?\s*(other\s*)?debits\b|total withdrawals\b|electronic\s+(payments|withdrawals|debits)\b|other withdrawals\b|service charges\b|service fees\b|checks paid\b|total subtractions\b|^fees\b|^debits\b|^checks\b|deductions?\b|checks and other deductions\b|purchases?\s*(and\s*other\s*)?charges?\b|cash advance(s)?\b|balance transfer(s)?\s*activity\b|fees\s*charged\b|new charges\b|debit\(?s\)?\s+this\s+period\b)/i;

  function findFirstColumnHeaderRowIndex(rows) {
    for (let i = 0; i < rows.length; i++) {
      const types = new Set(row_types(rows[i]));
      if (types.has('DATE') && types.has('DESC') && types.has('BALANCE')) return i;
    }
    // No header row has an explicit Balance column — fall back to the
    // original, looser rule rather than scanning the whole document.
    for (let i = 0; i < rows.length; i++) {
      const types = new Set(row_types(rows[i]));
      if (types.has('DATE') && types.has('DESC')) return i;
    }
    return rows.length;
  }

  function row_types(row) {
    return row.items.map((it) => classifyHeaderItem(it.text)).filter(Boolean);
  }

  // Walk a row left-to-right and pair each amount with the label text that
  // immediately precedes it (since the previous amount, or the start of the
  // row). This correctly separates multiple "label value" fields that a
  // y-based row grouping has merged onto one physical row (e.g. a
  // "Beginning Balance" box sitting beside an unrelated "Average Balance"
  // box) without needing to guess at a column-gap threshold.
  // Some PDFs render a "Label ..... $Amount" line (dot-leader style) as a
  // single text item rather than separate label/amount runs — the normal
  // per-item scan below never finds a pure amount token to pair against.
  // Recognize that shape directly: a label, then a run of dot-leaders
  // and/or spaces, then a trailing money value, all within one item.
  const EMBEDDED_LABEL_VALUE_RE = /^(.+?)[.\s]{2,}(\(?-?\$?[\d,]+\.\d{2}\)?)$/;

  function extractLabelValuePairs(row) {
    // A row with 3+ amount-shaped tokens is almost always a multi-column
    // tier summary (e.g. "Total New Charges  $0.00  $5,049.98  $5,049.98"
    // — Pay In Full / Pay Over Time / Total, one label but three values).
    // This simple one-label-one-value model has no reliable way to know
    // which column is the "real" total, and the wrong guess is worse than
    // no guess — extracting the Pay-In-Full column's $0 instead of the
    // actual $5,049.98 total would silently corrupt reconciliation.
    const amountCount = row.items.filter((it) => isAmountToken(it.text)).length;
    if (amountCount >= 3) return [];

    const pairs = [];
    let labelParts = [];
    for (const it of row.items) {
      if (isAmountToken(it.text)) {
        pairs.push({ label: labelParts.join(' ').replace(/\s+/g, ' ').trim(), value: parseAmount(it.text) });
        labelParts = [];
      } else {
        const m = it.text.match(EMBEDDED_LABEL_VALUE_RE);
        if (m) {
          pairs.push({ label: m[1].replace(/\.+$/, '').trim(), value: parseAmount(m[2]) });
        } else {
          labelParts.push(it.text);
        }
      }
    }
    return pairs;
  }

  // Cluster a set of items into x-position groups (a simple 1-D version of
  // splitColumns that also sorts each group back into top-to-bottom reading
  // order, since it's meant to reassemble a label that's wrapped across
  // multiple stacked physical rows at the same x — e.g. "Beginning" over
  // "balance").
  function clusterItemsByX(items, gapThreshold) {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    const clusters = [];
    let current = null;
    let prevX = null;
    for (const it of sorted) {
      if (!current || it.x - prevX > gapThreshold) {
        current = [];
        clusters.push(current);
      }
      current.push(it);
      prevX = it.x;
    }
    for (const c of clusters) c.sort((a, b) => b.y - a.y);
    return clusters;
  }

  // Some statements (e.g. PNC's "Balance Summary") lay a summary box out as
  // a true header-row-then-values-row table: several field labels — each
  // possibly wrapped across two stacked lines ("Beginning" / "balance") —
  // spread across different x positions, with the actual dollar figures
  // appearing together on a wholly separate row below, in the same x order.
  // extractLabelValuePairs can't see this (it only pairs a label with a
  // value on the *same* row); this clusters the preceding label-only rows
  // by x-position instead and matches each value to its nearest cluster,
  // the same nearest-column technique used for transaction tables.
  function detectSummaryBoxTotals(rows, boundary) {
    const totals = {};
    let i = 0;
    while (i < boundary) {
      const row = rows[i];
      if (findDateToken(row) || row.items.some((it) => isAmountToken(it.text)) || !row.text.trim()) {
        i++;
        continue;
      }
      const collected = [];
      let j = i;
      while (j < boundary && collected.length < 5) {
        const r = rows[j];
        if (findDateToken(r) || r.items.some((it) => isAmountToken(it.text)) || !r.text.trim()) break;
        collected.push(r);
        j++;
      }
      if (j >= boundary) break;
      const valueRow = rows[j];
      const amountItems = valueRow.items.filter((it) => isAmountToken(it.text));
      const nonAmountItems = valueRow.items.filter((it) => !isAmountToken(it.text));
      if (amountItems.length >= 2 && nonAmountItems.length === 0) {
        const labelItems = collected.flatMap((r) => r.items);
        const clusters = clusterItemsByX(labelItems, 30).map((c) => ({
          text: c.map((it) => it.text).join(' ').replace(/\s+/g, ' ').trim(),
          x: c.reduce((a, it) => a + it.x, 0) / c.length,
        }));
        if (clusters.length >= 2) {
          for (const amtIt of amountItems) {
            let best = null, bestDist = Infinity;
            for (const c of clusters) {
              const d = Math.abs(c.x - amtIt.x);
              if (d < bestDist) { bestDist = d; best = c; }
            }
            const val = parseAmount(amtIt.text);
            if (!best || val === null) continue;
            if (BEGIN_BAL_RE.test(best.text) && totals.beginningBalance === undefined) {
              totals.beginningBalance = val;
            } else if (END_BAL_RE.test(best.text) && totals.endingBalance === undefined) {
              totals.endingBalance = val;
            } else if (CREDIT_LABEL_RE.test(best.text) && totals.totalCredits === undefined) {
              totals.totalCredits = round2(Math.abs(val));
            } else if (DEBIT_LABEL_RE.test(best.text) && totals.totalDebits === undefined) {
              totals.totalDebits = round2(Math.abs(val));
            }
          }
        }
      }
      i = j + 1;
    }
    return totals;
  }

  function scanStatedTotals(rows) {
    const boundary = findFirstColumnHeaderRowIndex(rows);
    const totals = {};
    // Some card statements (e.g. Amex) print Previous/New Balance and
    // Payments/Charges totals THREE times — once for a "Pay In Full"
    // sub-tier, once for a "Pay Over Time" sub-tier, and once for the
    // authoritative combined "Account Total". Before that marker, use the
    // ordinary rule (first occurrence for balances, sum for credit/debit
    // totals) that every other bank statement needs; once seen, later
    // matches are the authoritative combined figure and should replace
    // whatever came before, not add to it.
    const GRAND_TOTAL_RE = /\baccount total\b/i;
    let sawGrandTotal = false;
    for (let i = 0; i < boundary; i++) {
      if (GRAND_TOTAL_RE.test(rows[i].text)) sawGrandTotal = true;
      for (const { label, value } of extractLabelValuePairs(rows[i])) {
        if (value === null || !label) continue;

        if (BEGIN_BAL_RE.test(label)) {
          if (sawGrandTotal || totals.beginningBalance === undefined) totals.beginningBalance = value;
        } else if (END_BAL_RE.test(label)) {
          if (sawGrandTotal || totals.endingBalance === undefined) totals.endingBalance = value;
        } else if (CREDIT_LABEL_RE.test(label)) {
          totals.totalCredits = sawGrandTotal ? Math.abs(value) : round2((totals.totalCredits || 0) + Math.abs(value));
        } else if (DEBIT_LABEL_RE.test(label)) {
          totals.totalDebits = sawGrandTotal ? Math.abs(value) : round2((totals.totalDebits || 0) + Math.abs(value));
        }
      }
    }
    // Fill any gaps (most commonly beginning/ending balance) from a
    // wrapped-header-style summary box the inline-pair scan above can't see.
    const fromClusters = detectSummaryBoxTotals(rows, boundary);
    for (const key of Object.keys(fromClusters)) {
      if (totals[key] === undefined) totals[key] = fromClusters[key];
    }
    return totals;
  }

  // ==========================================================================
  // 4. TABLE / TRANSACTION EXTRACTION — structural detection
  // ==========================================================================
  //
  // Design goal: don't rely on any bank's specific wording. A transaction
  // table is recognized by its SHAPE — a short title-like line, followed by
  // a column-header row carrying recognizable keywords (Date/Description/
  // Amount/Balance/etc.), followed by rows that start with a date token —
  // regardless of what the bank happens to call it. Whether a table is
  // "credits" or "debits" is resolved through a layered set of signals, from
  // most to least direct:
  //   1. The header itself has separate Credit and Debit columns (fully
  //      structural — no title reading needed at all).
  //   2. The header has only a Credit-type or only a Debit-type keyword.
  //   3. This bank has taught us this exact label before (persisted).
  //   4. This label is one of a small set of very common phrasings.
  //   5. Fuzzy keyword scoring on the title text.
  //   6. Unknown — guess credit, and let the reconciliation pass (below)
  //      catch and correct it against the statement's own printed totals.
  //
  // Whatever we land on gets checked against the statement's own stated
  // totals after extraction (see correctSignsWithReconciliation) and, once
  // reconciled, is remembered for this bank so the next statement from them
  // never has to guess again.

  // Section phrases that mean "stop capturing rows as transactions" (informational
  // blocks, worksheets, disclosures, daily-balance-only tables, etc.)
  const NON_TXN_SECTION_HEADERS = [
    /daily balance summary/i,
    /daily ending balance/i,
    /daily ledger balances/i,
    /daily balances?\b/i,
    /overdraft\/return item fees/i,
    /monthly service fee summary/i,
    /account transaction fees summary/i,
    /service charge summary/i,
    /^account summary\b/i,
    /^checks cleared\b/i,
    /summary of checks written/i,
    /overdraft protection/i,
    /how to balance your account/i,
    /account balance calculation worksheet/i,
    /important account information/i,
    /important information/i,
    /^questions\?/i,
    /customer service information/i,
    /in case of errors/i,
    /provision of emergency services/i,
    /new york city customers/i,
    /^this page intentionally left blank/i,
  ];

  const HEADER_KEYWORD_TYPES = [
    { re: /check\s*(no\.?|number|#)/i, type: 'CHECKNO' },
    { re: /date/i, type: 'DATE' },
    { re: /description/i, type: 'DESC' },
    { re: /(deposit|credit|addition|payment)/i, type: 'CREDIT' },
    { re: /(withdrawal|debit|subtraction)/i, type: 'DEBIT' },
    { re: /balance/i, type: 'BALANCE' },
    { re: /amount/i, type: 'AMOUNT' },
  ];

  function classifyHeaderItem(text) {
    for (const h of HEADER_KEYWORD_TYPES) {
      if (h.re.test(text)) return h.type;
    }
    return null;
  }

  const DATE_TOKEN_RE = /^\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?$/;
  const MONTH_ABBR_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?$/i;
  const MONTH_DAY_SINGLE_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i;

  // A "date span" is one or more adjacent PDF text items that together
  // spell out a date. Most banks print a single numeric token ("03/13",
  // "03/13/2026"); some print a month abbreviation and day ("Mar 01"),
  // which can surface either as one item (when the row-construction pass
  // upstream already merged tightly-spaced glyph runs together) or as two
  // separate adjacent items with a real word-gap between them — handle
  // both shapes.
  function findDateSpans(row) {
    const items = row.items;
    const spans = [];
    for (let i = 0; i < items.length; i++) {
      // A trailing "*" on a date (e.g. "01/03/25*") is a footnote marker
      // some issuers use to mean "this is a posting date, not a transaction
      // date" — strip it before matching, or the token fails the anchored
      // date pattern entirely and the whole row goes unrecognized.
      const t = items[i].text.trim().replace(/\*$/, '');
      if (DATE_TOKEN_RE.test(t)) {
        spans.push({ text: t, startIdx: i, endIdx: i + 1 });
        continue;
      }
      if (MONTH_DAY_SINGLE_RE.test(t)) {
        spans.push({ text: t.replace(/\.(?=\s)/, ''), startIdx: i, endIdx: i + 1 });
        continue;
      }
      if (MONTH_ABBR_RE.test(t.replace(/\.$/, '')) && i + 1 < items.length) {
        const dayTok = items[i + 1].text.trim().replace(/,$/, '');
        if (/^\d{1,2}$/.test(dayTok)) {
          let endIdx = i + 2;
          let text = `${items[i].text.replace(/\.$/, '')} ${dayTok}`;
          const yearTok = i + 2 < items.length ? items[i + 2].text.trim().replace(/,$/, '') : '';
          if (/^\d{4}$/.test(yearTok)) {
            text += ` ${yearTok}`;
            endIdx = i + 3;
          }
          spans.push({ text, startIdx: i, endIdx });
        }
      }
    }
    return spans;
  }

  function findDateToken(row) {
    const spans = findDateSpans(row);
    return spans.length ? spans[0].text : null;
  }

  // Some statements print multiple side-by-side record blocks on one
  // physical text line (e.g. a two- or three-column "Checks Paid" ledger:
  // "01/06 50277 100.97   01/08 64130 4,667.00" is really TWO separate
  // checks sharing one row). Detect rows with more than one date token and
  // split them into one synthetic row per date, so each record is treated
  // as its own transaction instead of only the first being kept. This
  // generalizes to any column count (2, 3, 4...) without needing to know
  // which bank does this.
  function explodeMultiRecordRow(row) {
    const spans = findDateSpans(row);
    if (spans.length <= 1) return [row];
    const parts = [];
    for (let i = 0; i < spans.length; i++) {
      const start = spans[i].startIdx;
      const end = i + 1 < spans.length ? spans[i + 1].startIdx : row.items.length;
      const items = row.items.slice(start, end);
      parts.push({
        y: row.y,
        page: row.page,
        items,
        text: items
          .map((it) => it.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
    return parts;
  }

  const HARD_STRUCTURAL_TYPES = new Set(['DATE', 'DESC', 'BALANCE', 'AMOUNT', 'CHECKNO']);

  function containsHardStructuralType(row) {
    return row.items.some((it) => {
      const ty = classifyHeaderItem(it.text);
      return ty && HARD_STRUCTURAL_TYPES.has(ty);
    });
  }

  function rowLooksLikeHeaderFragment(row) {
    // A header row/fragment: contains at least one classifiable keyword,
    // and does NOT contain a date token or a currency amount. This is what
    // structurally distinguishes a real column-header row from everything
    // else (including a summary-box line like "Checks Paid 69,404.57",
    // which has an amount and therefore never qualifies).
    if (findDateToken(row)) return false;
    const hasAmount = row.items.some((it) => isAmountToken(it.text));
    if (hasAmount) return false;
    // A long prose sentence (a disclaimer, a footnote legend explaining a
    // symbol, etc.) can easily contain a keyword substring like "date" or
    // "amount" without being anywhere near a real column header — but a
    // genuinely long header exists too (a repeating multi-column grid like
    // "Date Check Reference ... Date Check Reference ... Date Check
    // Reference", 3 columns of the same few labels). The distinguishing
    // signal is repetition: a real (even long) header reuses the same
    // handful of words over and over; a prose sentence doesn't.
    const words = row.text.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    if (wordCount > 8) {
      const uniqueRatio = new Set(words.map((w) => w.toLowerCase())).size / wordCount;
      if (uniqueRatio > 0.6) return false;
    }
    const types = row.items.map((it) => classifyHeaderItem(it.text)).filter(Boolean);
    if (!types.length) return false;
    if (types.some((ty) => HARD_STRUCTURAL_TYPES.has(ty))) return true;
    // Soft-only (CREDIT/DEBIT) match: a real wrapped column-header fragment
    // is terse ("Deposits/", "Credits", "Debits"). A natural-language
    // umbrella heading that merely contains one of the same words — e.g.
    // "Deposits and Other Additions" sitting above the *real* table two
    // rows down — is not, and must not get swept into the header merge
    // (which would misidentify the section's title and skip the row that
    // actually names it).
    return wordCount <= 3;
  }

  // A candidate section TITLE line: short, no date, no amount, and no long
  // digit runs (which would suggest it's actually a wrapped description /
  // reference-number continuation line rather than a real title). Some PDF
  // templates also embed invisible anchor/marker text (e.g. Chase's
  // "*start*summary*end*summary") in the text layer — exclude anything with
  // that shape too.
  // Some statements glue a footnote/disclaimer onto the same physical line
  // as a section title (e.g. "Checks Paid (continued) *Indicates break in
  // serial sequence..."). Strip that trailing footnote before evaluating or
  // using the line as a title, rather than rejecting the whole line outright.
  function stripFootnoteSuffix(text) {
    return text
      .split(/\s*\*(?=[A-Za-z])/)[0]
      .replace(/\s*\*+\s*$/, '')
      .trim();
  }

  function looksLikeSectionTitle(row) {
    if (findDateToken(row)) return false;
    if (row.items.some((it) => isAmountToken(it.text))) return false;
    const t = stripFootnoteSuffix(row.text);
    if (!t || /\d{3,}/.test(t) || /[_{}<>]/.test(t)) return false;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 6) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    return true;
  }

  // Page-footer boilerplate (branch phone numbers, "Member FDIC", etc.)
  // doesn't match looksLikeSectionTitle — it's usually rejected for having a
  // 3+ digit run (a phone number) — nor rowLooksLikeHeaderFragment, so
  // without a dedicated check it silently gets swallowed as a "continuation"
  // of whatever transaction happens to be open when the page ends,
  // corrupting that row's description.
  const BOILERPLATE_FOOTER_RE = /\(\d{3}\)\s*\d{3}[-.\s]?\d{4}|\bmember fdic\b|\bequal housing lender\b|\bbranch phone\b|\bfdic insured\b|\bpage\s+\d+\s+of\s+\d+\b/i;

  function looksLikeBoilerplateFooter(row) {
    return BOILERPLATE_FOOTER_RE.test(row.text);
  }

  // A genuine title carries at most one structural signal of its own (e.g.
  // "Electronic Deposits" → just CREDIT). A row carrying two or more column
  // types (e.g. "Date Check Number Description" → DATE + DESC) is itself
  // part of the column header, not a title, even if short enough to
  // otherwise pass looksLikeSectionTitle.
  function hasMultipleColumnTypes(row) {
    const types = new Set(row.items.map((it) => classifyHeaderItem(it.text)).filter(Boolean));
    return types.size >= 2;
  }

  function cleanSectionTitle(t) {
    return t
      .replace(/\(\s*continued\s*\)/i, '')
      .replace(/-\s*continued\b/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildColumnMap(headerRows) {
    // headerRows: array of merged rows forming the header. Compute an x
    // anchor (average x) per semantic column type.
    const buckets = {};
    for (const row of headerRows) {
      for (const it of row.items) {
        const type = classifyHeaderItem(it.text);
        if (!type) continue;
        if (!buckets[type]) buckets[type] = [];
        buckets[type].push(it.x);
      }
    }
    const map = {};
    for (const type of Object.keys(buckets)) {
      const xs = buckets[type];
      map[type] = xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    return map;
  }

  function nearestColumn(x, columnMap, allowedTypes) {
    let best = null;
    let bestDist = Infinity;
    for (const type of allowedTypes) {
      if (!(type in columnMap)) continue;
      const d = Math.abs(columnMap[type] - x);
      if (d < bestDist) {
        bestDist = d;
        best = type;
      }
    }
    return best;
  }

  function matchesAny(text, patterns) {
    return patterns.some((re) => re.test(text));
  }

  // ---- Sign resolution: keyword scoring, seeds, and persisted memory -----

  function normalizeLabel(text) {
    return (text || '')
      .toLowerCase()
      .replace(/\(\s*continued\s*\)/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const CREDIT_KEYWORDS = ['deposit', 'deposits', 'credit', 'credits', 'addition', 'additions', 'refund', 'incoming'];
  const DEBIT_KEYWORDS = [
    'withdrawal', 'withdrawals', 'debit', 'debits', 'payment', 'payments', 'check', 'checks',
    'fee', 'fees', 'charge', 'charges', 'purchase', 'purchases', 'subtraction', 'subtractions', 'disbursement',
    'deduction', 'deductions', 'outgoing',
  ];

  function keywordSign(label) {
    const norm = normalizeLabel(label);
    if (!norm) return 0;
    let creditScore = 0, debitScore = 0;
    for (const w of CREDIT_KEYWORDS) if (new RegExp(`\\b${w}\\b`).test(norm)) creditScore++;
    for (const w of DEBIT_KEYWORDS) if (new RegExp(`\\b${w}\\b`).test(norm)) debitScore++;
    if (creditScore > debitScore) return 1;
    if (debitScore > creditScore) return -1;
    return 0;
  }

  // A small seed set of very common section-title phrasings, kept as a
  // fast, always-correct shortcut so well-known US bank statements don't
  // need to lean on the (still fully general) keyword/correction fallback.
  const SEED_SIGNS = {
    'deposits and other credits': 1, 'withdrawals and other debits': -1,
    'electronic deposits': 1, 'other credits': 1,
    'electronic payments': -1, 'other withdrawals': -1,
    'service charges': -1, 'service fees': -1,
    'deposits and additions': 1, 'checks paid': -1,
    'fees': -1, 'debits': -1, 'credits': 1, 'checks': -1, 'deposits': 1,
    'payments': 1,
  };

  // ---- Persisted per-bank template memory (localStorage) -----------------

  const TEMPLATE_STORE_KEY = 'bse_bank_templates_v1';

  function loadTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATE_STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveTemplates(obj) {
    try {
      localStorage.setItem(TEMPLATE_STORE_KEY, JSON.stringify(obj));
    } catch (e) {
      /* storage unavailable (private mode, quota, etc.) — degrade silently */
    }
  }

  let TEMPLATES = loadTemplates();

  function normalizeBankKey(bank) {
    return (bank || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  function getTemplateSign(bank, label) {
    const bk = normalizeBankKey(bank);
    const lk = normalizeLabel(label);
    if (TEMPLATES[bk] && lk in TEMPLATES[bk]) return TEMPLATES[bk][lk];
    return undefined;
  }

  function rememberTemplateSign(bank, label, sign) {
    const bk = normalizeBankKey(bank);
    const lk = normalizeLabel(label);
    if (!lk) return;
    if (!TEMPLATES[bk]) TEMPLATES[bk] = {};
    TEMPLATES[bk].__name = bank; // preserve real display casing, e.g. "TD Bank"
    const isNew = !(lk in TEMPLATES[bk]);
    TEMPLATES[bk][lk] = sign;
    saveTemplates(TEMPLATES);
    return isNew;
  }

  function templateLabelCount(bk) {
    return Object.keys(TEMPLATES[bk]).filter((k) => k !== '__name').length;
  }

  function templateStats() {
    let banks = 0, labels = 0;
    for (const bk of Object.keys(TEMPLATES)) {
      banks++;
      labels += templateLabelCount(bk);
    }
    return { banks, labels };
  }

  function clearTemplates() {
    TEMPLATES = {};
    try {
      localStorage.removeItem(TEMPLATE_STORE_KEY);
    } catch (e) {}
  }

  function resolveSign(bank, name, columnMap) {
    const creditCol = 'CREDIT' in columnMap;
    const debitCol = 'DEBIT' in columnMap;
    if (creditCol && debitCol) return { value: 0, source: 'columns-mixed' };
    if (creditCol && !debitCol) return { value: 1, source: 'columns' };
    if (debitCol && !creditCol) return { value: -1, source: 'columns' };

    const learned = getTemplateSign(bank, name);
    if (learned !== undefined) return { value: learned, source: 'memory' };

    const norm = normalizeLabel(name);
    if (norm in SEED_SIGNS) return { value: SEED_SIGNS[norm], source: 'seed' };

    const kw = keywordSign(name);
    if (kw !== 0) return { value: kw, source: 'keyword' };

    return { value: 1, source: 'default' };
  }

  // ---- Main structural extraction loop ------------------------------------

  // A genuine column-header BLOCK: one or more consecutive keyword-only rows
  // (no date, no amount — see rowLooksLikeHeaderFragment) that together
  // carry at least two distinct column types (Date, Description, Amount,
  // Credit, Debit, Balance, CheckNo...) and are immediately followed by a
  // row that actually starts a transaction. Requiring >=2 types on a single
  // row would reject real multi-line-wrapped headers (some banks print
  // "Deposits/" on one line and "Credits" on the next); requiring it only
  // across the accumulated block — rather than on any single bare title —
  // is what keeps a plain title line like "Electronic Deposits" (which
  // contains the single word "Deposits") from being mistaken for an actual
  // column header.
  function detectHeaderBlockStart(rows, i) {
    if (!rowLooksLikeHeaderFragment(rows[i])) return null;
    const collected = [];
    const types = new Set();
    let j = i;
    while (j < rows.length && rowLooksLikeHeaderFragment(rows[j]) && collected.length < 8) {
      collected.push(rows[j]);
      rows[j].items.forEach((it) => {
        const ty = classifyHeaderItem(it.text);
        if (ty) types.add(ty);
      });
      j++;
    }
    // A lone "Amount" header — no separate Date/Description column labels
    // printed at all — is still a valid table start when the very next row
    // visibly begins with a date. This is deliberately narrow (a single
    // collected row, exactly the AMOUNT type, nothing else) so a stray
    // mention of the word "amount" elsewhere can't trigger it by accident.
    const bareAmountOk = collected.length === 1 && types.size === 1 && types.has('AMOUNT');
    if (types.size < 2 && !bareAmountOk) return null;
    if (j < rows.length && findDateToken(rows[j])) return { headerRows: collected, nextIndex: j };
    // tolerate a single stray non-data row before the real data starts
    if (j + 1 < rows.length && !findDateToken(rows[j]) && findDateToken(rows[j + 1])) {
      return { headerRows: collected, nextIndex: j };
    }
    return null;
  }

  // When no title line precedes a header block, name the section from what
  // the header itself tells us (still fully structural, no bank-specific
  // wording required).
  function guessTitleFromColumnMap(columnMap) {
    if ('CHECKNO' in columnMap) return 'Checks';
    if ('CREDIT' in columnMap && !('DEBIT' in columnMap)) return 'Deposits';
    if ('DEBIT' in columnMap && !('CREDIT' in columnMap)) return 'Withdrawals';
    return 'Transactions';
  }

  // Looks ahead from `from` (within `lookahead` rows) for two consecutive
  // date-starting rows, tolerating a small number of non-tabular lines in
  // between (footnotes, "(continued)" disclaimers, blank captions). This is
  // what lets a title like "Checks Paid (continued)" — which on a repeated
  // page may be followed by a footnote line before the data resumes — still
  // be recognized as opening the same kind of table as the original.
  function findDateRunWithin(rows, from, lookahead, includeStart) {
    const start = includeStart ? from - 1 : from;
    for (let k = start; k < Math.min(rows.length - 1, start + lookahead); k++) {
      if (k < 0) continue;
      if (findDateToken(rows[k]) && findDateToken(rows[k + 1])) return true;
    }
    return false;
  }

  function extractTransactions(rows, bank) {
    const transactions = [];
    let section = null; // {name, sign, signSource}
    let columnMap = {};
    let current = null; // in-progress transaction accumulator

    // Expand any physical row that actually packs multiple record-blocks
    // side by side (see explodeMultiRecordRow) into separate rows first.
    const expandedRows = [];
    for (const row of rows) expandedRows.push(...explodeMultiRecordRow(row));
    rows = expandedRows;

    function flushCurrent() {
      if (current && current.dateText) {
        finalizeTransaction(current, columnMap, section, transactions);
      }
      current = null;
    }

    const CC_SIGN_INVERTED_SECTION_RE = /(payments?\s*(and\s*(other\s*)?)?credits?\b|purchases?\s*(and\s*other\s*)?charges?\b|fees\s*charged\b|cash advance(s)?\b|balance transfer(s)?\b|^payments\b|^credits\b|new charges\b)/i;

    // A bare CC-style label (e.g. "Payments and Other Credits") sometimes
    // appears before the table it belongs to has structurally "opened" yet
    // — e.g. right before an unrelated interrupting page (a dispute-form
    // page here) pushes the real header/data further down the document.
    // This is remembered and consumed the next time openSection() runs,
    // so the label still applies once the table actually starts.
    let pendingCcContext = null;

    function openSection(rawTitle) {
      const name = cleanSectionTitle(rawTitle);
      let resolved, trustExplicitSign;
      if (pendingCcContext) {
        resolved = pendingCcContext.resolved;
        trustExplicitSign = pendingCcContext.trustExplicitSign;
      } else {
        resolved = resolveSign(bank, name, columnMap);
        trustExplicitSign = !CC_SIGN_INVERTED_SECTION_RE.test(name);
      }
      section = { name, sign: resolved.value, signSource: resolved.source, trustExplicitSign };
      if (window.__DEBUG_SECTIONS__) console.log('[section open]', name, 'sign=', resolved.value, 'source=', resolved.source, 'trust=', trustExplicitSign, JSON.stringify(columnMap));
    }

    // A two-column account-summary box (Previous Balance / Deposits/Credits
    // on the left, Statement Dates / Average Ledger on the right) sometimes
    // collapses onto a single OCR-read line, since OCR's line-grouping
    // doesn't preserve the same column separation a real PDF text layer
    // does. Two or more of these summary-only label phrases together on
    // one row is an unambiguous signal this is that box, not a real
    // transaction — no legitimate transaction description mixes multiple
    // of these unrelated account-summary concepts.
    const SUMMARY_BOX_SIGNATURE_RE = /(deposits\s*\/\s*credits|checks\s*\/\s*debits|statement\s+period|average\s+ledger|average\s+collected|days\s+in\s+the\s+statement)/gi;

    function looksLikeCollapsedSummaryBox(text) {
      const matches = text.match(SUMMARY_BOX_SIGNATURE_RE);
      return !!matches && matches.length >= 2;
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const t = row.text;

      // A bare sub-label row inside an already-open table — e.g. a credit
      // card statement's "Purchases and Other Charges" appearing as its
      // own row partway through one continuous "Posting/Transaction Date"
      // table, rather than as a title before a freshly-repeated column
      // header. Always update pendingCcContext (for the next openSection
      // call); if a section is already open, also apply immediately.
      if (!findDateToken(row) && !row.items.some((it) => isAmountToken(it.text)) && !matchesAny(t, NON_TXN_SECTION_HEADERS)) {
        const cleaned = cleanSectionTitle(t);
        if (CC_SIGN_INVERTED_SECTION_RE.test(cleaned) || CREDIT_LABEL_RE.test(cleaned) || DEBIT_LABEL_RE.test(cleaned)) {
          const words = cleaned.split(/\s+/).filter(Boolean);
          if (words.length > 0 && words.length <= 6) {
            // Strip a trailing "Amount" word merged onto the same line as
            // the label itself (e.g. "Payments Amount") BEFORE resolving
            // its sign — otherwise the seed/keyword lookup never sees the
            // clean "Payments" it needs to match, and the section also
            // gets a name that repeats the column header.
            const label = cleaned.replace(/\s*\bamounts?\b\s*$/i, '').trim() || cleaned;
            const resolved = resolveSign(bank, label, columnMap);
            const trustExplicitSign = !CC_SIGN_INVERTED_SECTION_RE.test(cleaned);
            pendingCcContext = { resolved, trustExplicitSign, label };
            if (section) {
              flushCurrent();
              section = { name: label, sign: resolved.value, signSource: resolved.source, trustExplicitSign };
              if (window.__DEBUG_SECTIONS__) console.log('[mid-table sub-label]', label, 'sign=', resolved.value, 'source=', resolved.source);
            } else if (i + 1 < rows.length && findDateToken(rows[i + 1])) {
              // No section currently open, and real data starts on the very
              // next row — nothing else is going to call openSection() for
              // this table, so open it now using this label directly. The
              // label row itself carries the "Amount" column's x-position,
              // so it can double as its own (minimal) header for column mapping.
              flushCurrent();
              section = { name: label, sign: resolved.value, signSource: resolved.source, trustExplicitSign };
              // Build columnMap from only the "Amount" word's own position —
              // classifying the rest of this row (e.g. "Payments" or
              // "Credits") the normal way would manufacture a false
              // CREDIT/DEBIT *column* entry, which then wrongly short-circuits
              // sign resolution for whatever section opens next (columnMap
              // is shared state across the whole loop, not reset per-row).
              const amountItem = row.items.find((it) => /^amounts?$/i.test(it.text.trim()));
              columnMap = amountItem ? { AMOUNT: amountItem.x } : {};
              if (window.__DEBUG_SECTIONS__) console.log('[mid-table sub-label, immediate open]', label, 'sign=', resolved.value, 'source=', resolved.source, JSON.stringify(columnMap));
            }
            continue;
          }
        }
      }

      if (looksLikeCollapsedSummaryBox(t)) {
        continue;
      }

      // Non-transaction informational sections: stop capturing, and skip
      // everything that belongs to this blocked section — not just this
      // title line. A structural header row (e.g. "Date Description
      // Amount") immediately following would otherwise still be recognized
      // on its own merits and use this blocked title as its look-back
      // title, letting its data rows through as if the section were legitimate.
      if (matchesAny(t, NON_TXN_SECTION_HEADERS)) {
        flushCurrent();
        section = null;
        columnMap = {};
        // Skip through the blocked section's own header row and data
        // (a structural header block found immediately after the blocked
        // title still belongs to it, e.g. "Service Charge Summary" ->
        // "Date Description Amount" -> its 2 fee rows). Only stop once a
        // genuine new decorative title has appeared in between — that's
        // what distinguishes "resume at a real, later section" from
        // "this is still the blocked table."
        let j = i + 1;
        let sawFreshTitle = false;
        while (j < rows.length) {
          const rt = rows[j].text;
          if (matchesAny(rt, NON_TXN_SECTION_HEADERS)) break; // another blocked title; let the outer loop re-check it
          if (sawFreshTitle && detectHeaderBlockStart(rows, j)) break;
          if (looksLikeSectionTitle(rows[j]) && !rowLooksLikeHeaderFragment(rows[j])) sawFreshTitle = true;
          j++;
        }
        i = j - 1; // loop's i++ lands exactly on j
        continue;
      }

      const headerBlock = detectHeaderBlockStart(rows, i);
      if (headerBlock) {
        flushCurrent();
        columnMap = buildColumnMap(headerBlock.headerRows);

        // Determine the section's display name. The common, unambiguous
        // case is exactly [Title row, real column-header row] — e.g.
        // "Electronic Deposits" followed by "POSTING DATE DESCRIPTION
        // AMOUNT" — where the header row is already self-sufficient (>=2
        // column types) on its own, so the title row is safe to read as a
        // genuine descriptive title rather than another header fragment.
        // This deliberately does NOT fire for a long wrapped header split
        // across many single-word fragment rows (e.g. "Date" / "Deposits/"
        // / "Credits" / ... each on their own line) — there, no single
        // fragment is a decorative title, so we fall back to whatever title
        // line precedes the whole block, or a structural guess.
        let title = null;
        if (headerBlock.headerRows.length === 2) {
          const [row0, row1] = headerBlock.headerRows;
          const row1Types = new Set(row1.items.map((it) => classifyHeaderItem(it.text)).filter(Boolean));
          if (
            looksLikeSectionTitle(row0) &&
            !containsHardStructuralType(row0) &&
            !hasMultipleColumnTypes(row0) &&
            row1Types.size >= 2
          ) {
            title = stripFootnoteSuffix(row0.text);
          }
        }
        if (
          !title &&
          i > 0 &&
          looksLikeSectionTitle(rows[i - 1]) &&
          !containsHardStructuralType(rows[i - 1]) &&
          !hasMultipleColumnTypes(rows[i - 1])
        ) {
          title = stripFootnoteSuffix(rows[i - 1].text);
        }
        if (!title) title = pendingCcContext && pendingCcContext.label ? pendingCcContext.label : guessTitleFromColumnMap(columnMap);

        openSection(title);
        i = headerBlock.nextIndex - 1; // loop's i++ lands exactly on nextIndex
        continue;
      }

      // Totals / subtotal lines close out the current transaction (they are
      // not one themselves) but the section stays open — more rows (e.g. a
      // card-account subtotal mid-table) may still follow.
      if (/^total|^subtotal/i.test(t) && row.items.some((it) => isAmountToken(it.text))) {
        flushCurrent();
        continue;
      }

      if (!section) {
        // Fallback structural trigger for tables that skip a printed column
        // header entirely (or, for a "(continued)" table, skip it because
        // the header only prints once): a short title line, possibly
        // followed by a line or two of non-tabular text (disclaimers,
        // "*indicates..." footnotes), then a run of date-starting rows.
        if (looksLikeSectionTitle(row) && findDateRunWithin(rows, i + 1, 3)) {
          columnMap = {};
          openSection(stripFootnoteSuffix(row.text));
          continue;
        }
        // Last-resort fallback: a run of date-starting rows with no title
        // and no header at all. Better to capture it under a generic label
        // (and flag it) than silently drop real transactions.
        if (findDateToken(row) && findDateRunWithin(rows, i + 1, 2, /*includeStart*/ true)) {
          columnMap = {};
          section = { name: 'Transactions', sign: 1, signSource: 'default' };
        } else {
          continue; // stray row outside any recognized table — ignore
        }
      }

      const dateToken = findDateToken(row);
      if (dateToken) {
        flushCurrent();
        current = { rows: [row], dateText: dateToken };
      } else if (current) {
        // Only swallow this row as a wrapped-description continuation of
        // the pending transaction if it doesn't itself look like the start
        // of something else — a title, a lone structural keyword, or a run
        // that's gone on implausibly long for a real multi-line memo. A
        // sparse table (as few as one real row) is often followed directly
        // by unrelated page furniture (a balance-summary heading, page
        // boilerplate) with no closing "Total:" line to signal the table
        // actually ended; without this guard that text gets silently
        // absorbed into the transaction and its numbers can overwrite the
        // real amount.
        if (rowLooksLikeHeaderFragment(row) || looksLikeSectionTitle(row) || looksLikeBoilerplateFooter(row) || current.rows.length >= 4) {
          flushCurrent();
        } else {
          current.rows.push(row);
        }
      }
    }
    flushCurrent();

    return transactions;
  }

  function finalizeTransaction(acc, columnMap, section, out) {
    const allItems = [];
    for (const row of acc.rows) allItems.push(...row.items);

    const amountItems = allItems.filter((it) => isAmountToken(it.text));

    // Build description text: drop amount tokens and the date span that
    // started this transaction. Only the first row's date span is skipped
    // (by item index, not string equality — a two-token date like "Mar 01"
    // can't be matched against a single item's text); a continuation row's
    // own date-looking token, if any, is legitimate description content
    // (e.g. a reference number that happens to look date-shaped).
    const firstRowSpans = acc.rows.length ? findDateSpans(acc.rows[0]) : [];
    const dateSpan = firstRowSpans.length ? firstRowSpans[0] : null;

    let descParts = [];
    acc.rows.forEach((row, rowIdx) => {
      row.items.forEach((it, itemIdx) => {
        if (rowIdx === 0 && dateSpan && itemIdx >= dateSpan.startIdx && itemIdx < dateSpan.endIdx) return;
        if (isAmountToken(it.text)) return;
        descParts.push(it.text);
      });
    });
    let description = descParts.join(' ').replace(/\s+/g, ' ').trim();
    // Strip a leading lone "<" or check-mark artifact some banks print, and
    // a lone leading check-number-like token already represented elsewhere.
    description = description.replace(/^[<\u2713\u221a]\s*/, '').trim();

    if (!description) return; // nothing meaningful captured

    // Assign amounts to CREDIT / DEBIT / BALANCE / AMOUNT columns by nearest x.
    let credit = null, debit = null, balance = null, amount = null;
    let creditExplicit = false, debitExplicit = false, amountExplicit = false;
    const hasCreditCol = 'CREDIT' in columnMap;
    const hasDebitCol = 'DEBIT' in columnMap;
    const hasBalanceCol = 'BALANCE' in columnMap;
    const hasAmountCol = 'AMOUNT' in columnMap;

    for (const it of amountItems) {
      const allowed = [];
      if (hasCreditCol) allowed.push('CREDIT');
      if (hasDebitCol) allowed.push('DEBIT');
      if (hasBalanceCol) allowed.push('BALANCE');
      if (hasAmountCol) allowed.push('AMOUNT');
      let type = allowed.length ? nearestColumn(it.x, columnMap, allowed) : 'AMOUNT';
      const val = parseAmount(it.text);
      if (val === null) continue;
      const explicit = tokenHasExplicitSign(it.text);
      if (type === 'CREDIT' && credit === null) { credit = val; creditExplicit = explicit; }
      else if (type === 'DEBIT' && debit === null) { debit = val; debitExplicit = explicit; }
      else if (type === 'BALANCE' && balance === null) balance = val;
      else if (type === 'AMOUNT' && amount === null) { amount = val; amountExplicit = explicit; }
      else if (balance === null && type === 'BALANCE') balance = val;
    }

    const trustExplicit = section.trustExplicitSign !== false;

    let finalAmount, finalType;
    if (credit !== null && debit === null) {
      // A value that structurally matched a "credit" column but explicitly
      // carries its own negative sign (a combined signed Credits/Debits
      // column) is a debit regardless — the source's own sign always wins
      // over a structural column guess. Unless this section is known to
      // print an inverted convention (credit-card statements), in which
      // case the section's resolved sign is used instead.
      if (trustExplicit && creditExplicit && credit < 0) {
        finalAmount = -Math.abs(credit);
        finalType = 'Debit';
      } else {
        finalAmount = Math.abs(credit);
        finalType = 'Credit';
      }
    } else if (debit !== null && credit === null) {
      if (trustExplicit && debitExplicit && debit > 0) {
        finalAmount = Math.abs(debit);
        finalType = 'Credit';
      } else {
        finalAmount = -Math.abs(debit);
        finalType = 'Debit';
      }
    } else if (credit !== null && debit !== null) {
      // both matched (rare) - trust whichever is non-zero / larger context
      const c = Math.abs(credit), d = Math.abs(debit);
      finalAmount = c >= d ? c : -d;
      finalType = c >= d ? 'Credit' : 'Debit';
    } else if (amount !== null) {
      if (trustExplicit && amountExplicit) {
        // The token's own sign is definitive — don't let a guessed
        // section-level sign override an amount that already states its
        // own direction.
        finalAmount = amount;
      } else {
        const sign = section.sign || (amount < 0 ? -1 : 1);
        finalAmount = sign < 0 ? -Math.abs(amount) : Math.abs(amount);
      }
      finalType = finalAmount < 0 ? 'Debit' : 'Credit';
    } else {
      return; // no usable amount found; skip
    }

    out.push({
      dateRaw: acc.dateText,
      description,
      type: finalType,
      amount: finalAmount,
      balance,
      section: section.name,
      signSource: section.signSource,
    });
  }

  // ==========================================================================
  // 4b. RECONCILIATION-DRIVEN SIGN CORRECTION
  // ==========================================================================
  //
  // Every section whose sign was a guess (not read directly off separate
  // Credit/Debit columns) is a candidate. If the statement prints its own
  // totals, try flipping each guessed section and keep any flip that gets
  // the computed totals strictly closer to the printed ones. This is the
  // safety net for labels the keyword list and template memory don't know
  // yet — the bank's own numbers correct the guess.

  function correctSignsWithReconciliation(transactions, statedTotals) {
    if (statedTotals.totalCredits === undefined && statedTotals.totalDebits === undefined) {
      return { transactions, corrections: [] };
    }

    const bySection = {};
    for (const tx of transactions) {
      (bySection[tx.section] = bySection[tx.section] || []).push(tx);
    }
    const candidates = [];
    for (const name of Object.keys(bySection)) {
      const txs = bySection[name];
      const allCredit = txs.every((t) => t.type === 'Credit');
      const allDebit = txs.every((t) => t.type === 'Debit');
      if (allCredit || allDebit) candidates.push(name); // mixed (column-resolved) sections are never flipped
    }

    function totalsWith(flipped) {
      let credits = 0, debits = 0;
      for (const tx of transactions) {
        let isCredit = tx.type === 'Credit';
        if (flipped.has(tx.section)) isCredit = !isCredit;
        if (isCredit) credits += Math.abs(tx.amount);
        else debits += Math.abs(tx.amount);
      }
      return { credits: round2(credits), debits: round2(debits) };
    }

    function mismatch(totals) {
      let score = 0;
      if (statedTotals.totalCredits !== undefined) score += Math.abs(statedTotals.totalCredits - totals.credits);
      if (statedTotals.totalDebits !== undefined) score += Math.abs(statedTotals.totalDebits - totals.debits);
      return score;
    }

    let flipped = new Set();
    let bestScore = mismatch(totalsWith(flipped));
    let improved = true;
    while (improved && bestScore > 0.02) {
      improved = false;
      let bestCandidate = null, bestCandidateScore = bestScore;
      for (const name of candidates) {
        const trial = new Set(flipped);
        trial.has(name) ? trial.delete(name) : trial.add(name);
        const score = mismatch(totalsWith(trial));
        if (score < bestCandidateScore - 0.001) {
          bestCandidateScore = score;
          bestCandidate = name;
        }
      }
      if (bestCandidate !== null) {
        flipped.has(bestCandidate) ? flipped.delete(bestCandidate) : flipped.add(bestCandidate);
        bestScore = bestCandidateScore;
        improved = true;
      }
    }

    if (flipped.size) {
      for (const tx of transactions) {
        if (flipped.has(tx.section)) {
          tx.type = tx.type === 'Credit' ? 'Debit' : 'Credit';
          tx.amount = -tx.amount;
          tx.signSource = 'corrected';
        }
      }
    }
    return { transactions, corrections: [...flipped] };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ==========================================================================
  // 5. DATE NORMALIZATION USING STATEMENT PERIOD CONTEXT
  // ==========================================================================

  function normalizeTxnDate(dateRaw, range) {
    let month, day, year = null;
    const numeric = dateRaw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (numeric) {
      month = parseInt(numeric[1], 10);
      day = parseInt(numeric[2], 10);
      year = numeric[3] ? parseInt(numeric[3], 10) : null;
    } else {
      const worded = dateRaw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s+(\d{4}))?/);
      if (!worded || !MONTHS[worded[1].toLowerCase()]) return { iso: '', display: dateRaw };
      month = MONTHS[worded[1].toLowerCase()];
      day = parseInt(worded[2], 10);
      year = worded[3] ? parseInt(worded[3], 10) : null;
    }
    if (year !== null && year < 100) year += 2000;

    if (year === null) {
      const candidates = [];
      if (range.start) candidates.push(range.start.y);
      if (range.end) candidates.push(range.end.y);
      const uniq = [...new Set(candidates)];
      if (uniq.length === 0) {
        year = new Date().getFullYear();
      } else if (uniq.length === 1) {
        year = uniq[0];
      } else {
        // pick whichever year keeps the date inside/near [start,end]
        const startTs = range.start ? Date.UTC(range.start.y, range.start.m - 1, range.start.d) : -Infinity;
        const endTs = range.end ? Date.UTC(range.end.y, range.end.m - 1, range.end.d) : Infinity;
        let bestY = uniq[0], bestDist = Infinity;
        for (const y of uniq) {
          const ts = Date.UTC(y, month - 1, day);
          const dist = ts < startTs ? startTs - ts : ts > endTs ? ts - endTs : 0;
          if (dist < bestDist) { bestDist = dist; bestY = y; }
        }
        year = bestY;
      }
    }
    const iso = toISO(year, month, day);
    const display = `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${year}`;
    return { iso, display };
  }

  // ==========================================================================
  // 5b. QBO / QFX / OFX PARSER
  // ==========================================================================
  // QBO (QuickBooks Web Connect) and QFX (Quicken) are both just OFX —
  // Open Financial Exchange — a flat, fully structured text format. Older
  // OFX (1.x, "SGML" mode, what most bank downloads still use) leaves leaf
  // tags unclosed ("<TRNTYPE>DEBIT" with no </TRNTYPE>, terminated only by
  // the next tag or a line break); newer OFX (2.x) is real closed-tag XML.
  // Every field below is pulled with "everything up to the next '<' or line
  // break", which reads correctly under either style without needing to
  // know which one a given file uses. Unlike a PDF, nothing here is
  // inferred — every transaction carries its own explicit signed amount
  // and type, so there's no column-position guessing and no sign to
  // reconcile.

  function ofxField(block, tag) {
    const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : '';
  }

  function ofxBlocks(text, tag) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(text))) out.push(m[1]);
    return out;
  }

  // "20260730120000[0:GMT]" or "20260730" -> {iso, display}
  function parseOfxDate(raw) {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return { iso: '', display: raw };
    const [, y, mo, d] = m;
    return { iso: `${y}-${mo}-${d}`, display: `${mo}/${d}/${y}` };
  }

  function detectBankFromFileName(fileName) {
    const spaced = splitLetterDigitBoundaries(fileName).replace(/[_\-.]+/g, ' ');
    const known = detectBank(spaced);
    if (known !== 'Unknown Bank') return known;
    return guessBankFromFilename(fileName) || 'Unknown Bank';
  }

  const OFX_SECTION_BY_TRNTYPE = {
    CHECK: 'Checks Paid',
    DEBIT: 'Electronic Withdrawals',
    CREDIT: 'Deposits and Additions',
    ATM: 'ATM',
    POS: 'Point of Sale',
    FEE: 'Fees',
    SRVCHG: 'Service Charges',
    DEP: 'Deposits and Additions',
    XFER: 'Transfers',
    PAYMENT: 'Payments',
    INT: 'Interest',
    DIV: 'Dividends',
    OTHER: 'Other',
  };

  async function parseQBO(file, log) {
    log(`Reading ${file.name}...`);
    const text = await file.text();

    const bank = detectBankFromFileName(file.name);
    const acctBlock = (ofxBlocks(text, 'BANKACCTFROM')[0] || ofxBlocks(text, 'CCACCTFROM')[0] || '');
    const accountNumber = ofxField(acctBlock, 'ACCTID');
    // Carry the account's own routing/type through, so re-exporting a .qbo
    // that was just imported reproduces the same account identity rather
    // than falling back to a guessed routing number.
    const ofxRouting = ofxField(acctBlock, 'BANKID');
    const ofxAcctType = (ofxField(acctBlock, 'ACCTTYPE') || (ofxBlocks(text, 'CCACCTFROM')[0] ? 'CREDITCARD' : '')).toUpperCase();
    const dtStartRaw = ofxField(text, 'DTSTART');
    const dtEndRaw = ofxField(text, 'DTEND');
    const periodText =
      dtStartRaw && dtEndRaw
        ? `${parseOfxDate(dtStartRaw).display} to ${parseOfxDate(dtEndRaw).display}`
        : '(not detected)';

    const ledgerBlock = ofxBlocks(text, 'LEDGERBAL')[0] || '';
    const endingBalance = ledgerBlock ? parseAmount(ofxField(ledgerBlock, 'BALAMT')) : null;

    const txnBlocks = ofxBlocks(text, 'STMTTRN');
    const transactions = txnBlocks
      .map((block) => {
        const trnType = ofxField(block, 'TRNTYPE').toUpperCase();
        const amount = parseAmount(ofxField(block, 'TRNAMT'));
        if (amount === null) return null;
        const dt = parseOfxDate(ofxField(block, 'DTPOSTED'));
        const name = ofxField(block, 'NAME');
        const memo = ofxField(block, 'MEMO');
        const checkNum = ofxField(block, 'CHECKNUM');
        const descParts = [name, memo].filter(Boolean);
        if (checkNum && !name.includes(checkNum)) descParts.unshift(`Check #${checkNum}`);
        return {
          date: dt.display,
          dateISO: dt.iso,
          description: descParts.join(' — ').trim() || '(no description)',
          type: amount < 0 ? 'Debit' : 'Credit',
          amount,
          balance: null,
          section: OFX_SECTION_BY_TRNTYPE[trnType] || (amount < 0 ? 'Withdrawals' : 'Deposits'),
          signSource: 'exact',
        };
      })
      .filter(Boolean)
      // OFX lists most-recent-first; match the PDF pipeline's chronological order.
      .sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

    const computedCredits = round2(transactions.filter((t) => t.type === 'Credit').reduce((s, t) => s + t.amount, 0));
    const computedDebits = round2(
      transactions.filter((t) => t.type === 'Debit').reduce((s, t) => s + Math.abs(t.amount), 0)
    );
    // OFX doesn't print an independent "total credits/debits" to check
    // against — every amount is already exact, taken directly from the
    // file's own signed fields, so there's nothing to reconcile.
    const netChange = round2(computedCredits - computedDebits);
    const beginningBalance = endingBalance !== null ? round2(endingBalance - netChange) : null;

    const bySection = {};
    for (const tx of transactions) (bySection[tx.section] = bySection[tx.section] || []).push(tx);

    const summary = {
      fileName: file.name,
      bank,
      accountHolder: '',
      accountNumber,
      period: periodText,
      beginningBalance,
      endingBalance,
      statedCredits: null,
      statedDebits: null,
      computedCredits,
      computedDebits,
      creditsMatch: null,
      debitsMatch: null,
      transactionCount: transactions.length,
      sectionsDetected: Object.keys(bySection).length,
      recognizedFromMemory: [],
      autoCorrected: [],
      newlyLearned: 0,
      sourceFormat: 'qbo',
      ofxRouting,
      ofxAcctType,
    };

    log(`  → ${bank} | ${transactions.length} transactions read directly from file`);
    return { summary, transactions };
  }

  // ==========================================================================
  // 6. MAIN PARSE PIPELINE FOR ONE FILE
  // ==========================================================================

  // Set by the UI's OCR checkbox. Off by default: OCR is slow (seconds per
  // page) and meaningfully less trustworthy for financial figures than a
  // real text layer, so it should never run without the person explicitly
  // asking for it.
  let OCR_ENABLED = false;
  function setOcrEnabled(v) { OCR_ENABLED = v; }

  // ==========================================================================
  // Citi card statements (Costco Anywhere Visa and other Citi cards)
  // ==========================================================================
  // Layout: "Sale Date | Post Date | Description | Amount", credits printed
  // with a minus sign, a payment with only a post date, one "Standard
  // Purchases" block per cardholder, and a rewards panel printed beside the
  // list on the same lines. A long merchant name can wrap: its first part
  // sits on the line above the dates and the rest on the line below. The
  // general reader drops the one-date payment and pulls the rewards panel
  // into descriptions, so these statements are read here instead. Returns
  // null for any other statement, which then takes the general path.
  function readCitiCard(rows, bank, fullText) {
    if (bank !== 'Citibank' && !/citicards\.com|\bciti\s+cards\b/i.test(fullText.slice(0, 4000))) return null;
    const DATE = /^\d{2}\/\d{2}$/;
    const AMT = /^[-+]?\$[\d,]+\.\d{2}$/;
    const startIdx = rows.findIndex((r) => /\bDate\s+Date\s+Description\b.*\bAmount\b/.test(r.text) || /^Sale\s+Post\b/.test(r.text));
    if (startIdx < 0) return null;
    const stopRe = /^(Interest charge calculation|\d{4} totals year-to-date|Your Annual Percentage Rate)/i;
    const SECTION_RE = /^(Payments, Credits and Adjustments|Standard Purchases(?:, cont'd)?|Cash Advances(?:, cont'd)?|Balance Transfers|Fees Charged|Interest Charged|Citi Flex Pay[^$]*)\b/i;
    const NAME_RE = /^[A-Z][A-Z.'\-]+(?: [A-Z][A-Z.'\-]*){1,4}$/;
    const money = (t) => parseFloat(t.replace(/[$,+]/g, ''));
    // the amount token of a transaction row; "-" may be its own glyph just before "$"
    // glyph runs with a visible gap are separate words (the shared row builder glues "AMAZON" "MKTPLACE")
    const words = (row) => {
      const out = [];
      for (const i of (row.raw || row.items)) {
        const p = out[out.length - 1];
        if (p && i.x - (p.x + (p.width || 0)) < 0.6) { p.text += i.text; p.width = i.x + (i.width || 0) - p.x; }
        else out.push({ text: i.text, x: i.x, width: i.width || 0 });
      }
      return out.filter((i) => i.x > 40 && i.text.trim());   // a page-margin batch number sits at the far left
    };
    const parseRow = (row) => {
      const its = words(row);
      let k = 0; const dates = [];
      while (k < its.length && dates.length < 2 && DATE.test(its[k].text.trim())) dates.push(its[k++].text.trim());
      if (!dates.length) return null;
      const desc = [];
      for (; k < its.length; k++) {
        let t = its[k].text.trim();
        if (t === '-' && its[k + 1] && /^\$[\d,]+\.\d{2}$/.test(its[k + 1].text.trim())) { t = '-' + its[k + 1].text.trim(); k++; }
        if (AMT.test(t)) return { dates, desc: desc.join(' '), amount: money(t), amountX: its[k].x, row };
        desc.push(t);
      }
      return null;
    };
    const textBefore = (row, maxX) => words(row).filter((i) => i.x < maxX).map((i) => i.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
    let section = 'Transactions', holder = '';
    const txns = [];
    for (let i = startIdx + 1; i < rows.length; i++) {
      const row = rows[i], text = row.text.trim();
      if (stopRe.test(text)) break;
      const tx = parseRow(row);
      if (!tx) {
        const left = textBefore(row, 330);
        const sec = SECTION_RE.exec(left);
        if (sec) {
          section = sec[1].replace(/, cont'd$/i, '');
          // "NADIR SHERALI" on the line just above "Standard Purchases" names the cardholder
          const prev = rows[i - 1] && textBefore(rows[i - 1], 330);
          if (/^Standard Purchases$/i.test(section) && !/cont'd/i.test(left)) holder = prev && NAME_RE.test(prev) ? prev : holder;
          if (/^Payments/i.test(section)) holder = '';
        }
        continue;
      }
      let description = tx.desc;
      if (!description) {   // wrapped merchant name: the line above the dates and the line below
        const above = rows[i - 1] ? textBefore(rows[i - 1], tx.amountX) : '', below = rows[i + 1] ? textBefore(rows[i + 1], tx.amountX) : '';
        description = [above, below].filter((s) => s && !DATE.test(s.split(' ')[0])).join(' ');
        if (below && rows[i + 1] && !parseRow(rows[i + 1])) i++;
      }
      // The statement prints a charge as + and a payment or credit as -.
      // On the account a charge is money out (Debit), a payment money in (Credit).
      const out = tx.amount > 0;
      const secName = /^Standard Purchases$/i.test(section) && holder ? `Purchases · ${holder}` : section;
      txns.push({
        dateRaw: tx.dates[tx.dates.length - 1],   // the post date (the payment has only that one)
        description: description.replace(/\s+/g, ' ').trim(),
        type: out ? 'Debit' : 'Credit',
        amount: out ? -Math.abs(tx.amount) : Math.abs(tx.amount),
        balance: null,
        section: secName,
        signSource: 'exact',
        checkNumber: '',
        src: window.SSX && window.SSX.srcBox ? window.SSX.srcBox([row]) : undefined,
      });
    }
    if (!txns.length) return null;
    // Account Summary on page 1: Previous balance, Payments, Credits, Purchases, Cash advances, Fees, Interest, New balance
    const pick = (re) => { const m = re.exec(fullText); return m ? money(m[1]) : 0; };
    const has = (re) => re.test(fullText);
    const totals = {};
    if (has(/Previous balance\s+-?\$[\d,]+\.\d{2}/i)) {
      const prev = /Previous balance\s+(-?)\$([\d,]+\.\d{2})/i.exec(fullText);
      totals.beginningBalance = (prev[1] ? -1 : 1) * money(prev[2]);
      totals.totalCredits = Math.round((pick(/\bPayments\s+-\$([\d,]+\.\d{2})/) + pick(/\bCredits\s+-\$([\d,]+\.\d{2})/)) * 100) / 100;
      totals.totalDebits = Math.round((pick(/\bPurchases\s+\+\$([\d,]+\.\d{2})/) + pick(/Cash advances\s+\+\$([\d,]+\.\d{2})/i) +
        pick(/\bFees\s+\+\$([\d,]+\.\d{2})/) + pick(/\bInterest\s+\+\$([\d,]+\.\d{2})/) + pick(/Balance transfers\s+\+\$([\d,]+\.\d{2})/i)) * 100) / 100;
      const nb = /New balance\s+(-?)\$([\d,]+\.\d{2})/i.exec(fullText);
      if (nb) totals.endingBalance = (nb[1] ? -1 : 1) * money(nb[2]);
    }
    return { txns, totals };
  }

  async function parseStatement(file, log) {
    log(`Reading ${file.name}...`);
    let rows = await extractRows(file);
    let usedOcr = false;
    if (rows.length === 0) {
      if (OCR_ENABLED) {
        log('  No text layer found in this PDF — trying OCR (offline, can take a while)...');
        try {
          rows = await ocrExtractRows(file, log);
          usedOcr = true;
          log(`  OCR read ${rows.length} line(s) of text.`);
        } catch (err) {
          throw new Error(`OCR failed: ${err.message}`);
        }
        if (rows.length === 0) {
          throw new Error('OCR ran but found no readable text on any page.');
        }
      } else {
        throw new Error('This PDF has no text layer (likely a scan, or a "Print to PDF" of an on-screen viewer). Turn on "Try OCR" and re-convert to read it anyway.');
      }
    }
    const fullText = rows.map((r) => r.text).join('\n');
    // Bank name / account number should only ever be looked for in the
    // statement's own front matter (letterhead, address block, account
    // summary) — never across the full document. A transaction description
    // can coincidentally contain another bank's name (e.g. "Chase Card
    // Serv" as a merchant string in a PNC statement's ACH deduction line),
    // and searching the whole document risks matching that instead of the
    // statement's actual issuing bank.
    const frontMatterText = rows.slice(0, 90).map((r) => r.text).join('\n');

    const detectedBank = detectBank(frontMatterText);
    const accountNumber = detectAccountNumber(frontMatterText) || detectAccountNumber(fullText);
    // Account-holder exclusion only ever uses a bank name genuinely found in
    // the statement's own text — never a filename guess. A statement is
    // often named after the *customer* ("sneha_patel_llc_december.pdf"),
    // and if that guess were treated as "the bank," the holder-detector
    // would wrongly reject the customer's own real name for matching it.
    const accountHolder = detectAccountHolder(fullText, rows, detectedBank);
    let bank = detectedBank;
    if (bank === 'Unknown Bank') {
      const guess = guessBankFromFilename(file.name);
      // A filename guess that turns out to just be the account holder's own
      // name (very common — people name statements after their business,
      // not the bank) is worse than no guess at all; fall back to "Unknown
      // Bank" rather than mislabeling the customer as the bank.
      const looksLikeHolder = guess && accountHolder && (() => {
        const ng = normalizeLabel(guess), nh = normalizeLabel(accountHolder);
        return ng && nh && (ng === nh || nh.includes(ng) || ng.includes(nh));
      })();
      bank = guess && !looksLikeHolder ? guess : 'Unknown Bank';
    }
    const period = detectStatementPeriod(fullText);
    const range = periodToRange(period);
    const statedTotals = scanStatedTotals(rows);

    const citi = readCitiCard(rows, bank, fullText);
    if (citi) Object.assign(statedTotals, citi.totals);
    const rawTxns = citi ? citi.txns : extractTransactions(rows, bank);

    let transactions = rawTxns.map((tx) => {
      const d = normalizeTxnDate(tx.dateRaw, range);
      return {
        date: d.display,
        dateISO: d.iso,
        description: tx.description,
        type: tx.type,
        amount: tx.amount,
        balance: tx.balance,
        section: tx.section,
        signSource: tx.signSource,
      };
    });

    // Self-verification: reconcile guessed-sign sections against the
    // statement's own printed totals, and correct any that are wrong.
    const { transactions: correctedTxns, corrections } = correctSignsWithReconciliation(transactions, statedTotals);
    transactions = correctedTxns;

    // Learn: remember this bank's section labels for next time, using the
    // final (possibly corrected) sign. Mixed (column-resolved) sections
    // don't need remembering — they're resolved structurally every time.
    const bySection = {};
    for (const tx of transactions) (bySection[tx.section] = bySection[tx.section] || []).push(tx);
    const recognizedFromMemory = new Set();
    let newlyLearned = 0;
    for (const name of Object.keys(bySection)) {
      const txs = bySection[name];
      const allCredit = txs.every((t) => t.type === 'Credit');
      const allDebit = txs.every((t) => t.type === 'Debit');
      if (!allCredit && !allDebit) continue; // mixed section, nothing to learn
      if (txs[0].signSource === 'memory') recognizedFromMemory.add(name);
      const wasNew = rememberTemplateSign(bank, name, allCredit ? 1 : -1);
      if (wasNew) newlyLearned++;
    }

    // Reconciliation (computed after correction)
    const computedCredits = round2(
      transactions.filter((t) => t.type === 'Credit').reduce((s, t) => s + t.amount, 0)
    );
    const computedDebits = round2(
      transactions.filter((t) => t.type === 'Debit').reduce((s, t) => s + Math.abs(t.amount), 0)
    );

    // Distinctive credit-card-statement phrasing — used to default the QBO
    // account type sensibly, since these statements never mention routing
    // numbers or a checking/savings "beginning/ending balance" the way a
    // bank account statement does.
    const CREDIT_CARD_STATEMENT_RE = /(minimum payment due|new balance total|credit limit|purchases and other charges|payments and other credits|cash advance activity|balance transfer activity)/i;
    const isCreditCard = CREDIT_CARD_STATEMENT_RE.test(frontMatterText) || CREDIT_CARD_STATEMENT_RE.test(fullText.slice(0, 3000));

    const summary = {
      fileName: file.name,
      bank,
      accountHolder,
      accountNumber,
      period: period.text || '(not detected)',
      beginningBalance: statedTotals.beginningBalance ?? null,
      endingBalance: statedTotals.endingBalance ?? null,
      statedCredits: statedTotals.totalCredits ?? null,
      statedDebits: statedTotals.totalDebits ?? null,
      computedCredits,
      computedDebits,
      creditsMatch:
        statedTotals.totalCredits === undefined ? null : Math.abs(statedTotals.totalCredits - computedCredits) < 0.02,
      debitsMatch:
        statedTotals.totalDebits === undefined ? null : Math.abs(statedTotals.totalDebits - computedDebits) < 0.02,
      transactionCount: transactions.length,
      sectionsDetected: Object.keys(bySection).length,
      recognizedFromMemory: [...recognizedFromMemory],
      autoCorrected: corrections,
      newlyLearned,
      usedOcr,
      isCreditCard,
    };

    log(`  → ${bank} | ${transactions.length} transactions extracted`);
    if (corrections.length) log(`    ↳ auto-corrected sign for: ${corrections.join(', ')}`);
    if (recognizedFromMemory.size) log(`    ↳ recognized from memory: ${[...recognizedFromMemory].join(', ')}`);
    return { summary, transactions };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // ==========================================================================
  // 5c. OCR FALLBACK (opt-in, fully offline)
  // ==========================================================================
  // Some PDFs have no text layer at all — either a genuine scan, or (more
  // commonly in practice) a "Print to PDF" of an on-screen statement viewer
  // that rasterizes everything, leaving zero embedded fonts and zero
  // extractable characters even though the page looks like normal text.
  // pdf.js finds nothing to work with in either case.
  //
  // This runs entirely offline: the Tesseract worker script, its WASM core,
  // and the English trained-data file are all embedded in this HTML file
  // (via the same inert <script type="text/plain"> + Blob URL pattern used
  // for the pdf.js worker) and wired together using tesseract.js's
  // documented "pre-supplied language data" path — passing the trained data
  // directly as bytes rather than a URL — so no network fetch ever happens,
  // even though most tesseract.js guides assume a CDN is reachable.
  //
  // Crucially, Tesseract's own layout analysis already groups recognized
  // words into lines, so its output can be converted into exactly the same
  // {page, y, items:[{text,x,y,width}], text} row shape extractRows()
  // produces — meaning the entire structural pipeline downstream (column
  // detection, section/sign resolution, template memory, reconciliation)
  // runs completely unmodified on OCR-derived rows. OCR is just a second
  // way of producing rows; nothing past that point knows or cares which one
  // was used.

  let ocrWorkerPromise = null;

  function getOcrAssetBlobUrl(id, mime) {
    const text = id === 'tesseractCoreSrc' ? window.__OB_TESS_CORE_SRC__ : window.__OB_TESS_WORKER_SRC__;
    return URL.createObjectURL(new Blob([text], { type: mime }));
  }

  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function getOcrWorker(onLog) {
    if (ocrWorkerPromise) return ocrWorkerPromise;
    ocrWorkerPromise = (async () => {
      if (typeof Tesseract === 'undefined') throw new Error('OCR engine failed to load.');

      // tesseract.js's own worker-script always constructs the WASM core's
      // filename by appending onto whatever "corePath" it was given (taking
      // the "already a full URL" shortcut only when the path literally ends
      // in ".js" — a blob: URL never does, so this appends a filename onto
      // an opaque blob URL and produces something unloadable). Rather than
      // fight that construction, this intercepts importScripts() inside the
      // worker itself: any request whose URL contains "tesseract-core" is
      // served from the core script already embedded in this page — via
      // eval, since importScripts on a blob URL is itself unreliable when
      // this page is opened from file:// — instead of trying to load
      // whatever mangled URL tesseract.js built.
      const coreScriptText = window.__OB_TESS_CORE_SRC__;
      const workerScriptText = window.__OB_TESS_WORKER_SRC__;
      const bootstrap =
        '(function(){' +
        'var __CORE_SRC__=' + JSON.stringify(coreScriptText) + ';' +
        'var _orig=self.importScripts.bind(self);' +
        'self.importScripts=function(u){' +
        'if(String(u).indexOf("tesseract-core")!==-1){(0,eval)(__CORE_SRC__);return;}' +
        'return _orig(u);' +
        '};' +
        '})();\n' + workerScriptText;
      const workerPath = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
      const corePath = getOcrAssetBlobUrl('tesseractCoreSrc', 'application/javascript');

      // Gzip-compressed trained data, decoded from the embedded base64 text.
      // Passed as {code, data} rather than a language string — tesseract.js
      // uses the bytes directly in this form and never attempts a fetch.
      // It auto-detects and un-gzips based on the gzip magic bytes, so the
      // compressed form can be handed over as-is.
      const trainedData = base64ToUint8Array(window.__ENG_TRAINEDDATA_B64__);
      if (onLog) onLog('  Starting OCR engine (offline, first use only)...');
      const worker = await Tesseract.createWorker(
        [{ code: 'eng', data: trainedData }],
        1, // OEM.LSTM_ONLY
        // workerBlobURL:false makes tesseract.js instantiate the worker
        // directly from our blob URL (new Worker(workerPath)) instead of
        // wrapping it in a second blob that does importScripts(workerPath)
        // — that nested blob-inside-blob approach reliably fails to load
        // under a file:// page origin, the same way every copy of this
        // tool is opened.
        { workerPath, corePath, workerBlobURL: false, logger: () => {} }
      );
      return worker;
    })();
    return ocrWorkerPromise;
  }

  // Convert one Tesseract recognize() result into rows matching extractRows()'s
  // shape. Tesseract's own line grouping is used directly rather than
  // re-deriving it, and pixel y is flipped (image-space grows downward, our
  // convention grows upward like PDF space) so sorting/section logic that
  // assumes "higher y = earlier on the page" still works unchanged.
  function ocrResultToRows(data, page, imageHeight) {
    const rows = [];
    const blocks = data.blocks || [];
    for (const block of blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const words = (line.words || []).filter((w) => w.text && w.text.trim());
          if (!words.length) continue;
          const items = words
            .map((w) => ({
              text: w.text.trim(),
              x: w.bbox.x0,
              y: imageHeight - (w.bbox.y0 + w.bbox.y1) / 2,
              width: w.bbox.x1 - w.bbox.x0,
            }))
            .sort((a, b) => a.x - b.x);
          const y = imageHeight - (line.bbox.y0 + line.bbox.y1) / 2;
          rows.push({
            page,
            y,
            items,
            text: items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim(),
          });
        }
      }
    }
    // Sort top-to-bottom, matching extractRows()'s ordering.
    rows.sort((a, b) => b.y - a.y);
    return rows;
  }

  // OCR of a picture (photo or scan saved as PNG/JPG), same row shape as ocrExtractRows. Small pictures are scaled
  // up so the text is about the size OCR reads best (VaultBook 1.33, paystubs).
  async function ocrImageRows(file, onProgress) {
    const worker = await getOcrWorker(onProgress);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This picture could not be opened.')); i.src = url; });
      const k = Math.max(1, Math.min(3, 2400 / Math.max(img.naturalWidth, 1)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (onProgress) onProgress('  OCR: reading the picture...');
      const { data } = await worker.recognize(canvas);
      const rows = ocrResultToRows(data, 1, canvas.height);
      canvas.width = 0; canvas.height = 0;
      return rows;
    } finally { URL.revokeObjectURL(url); }
  }

  // ==========================================================================
  // 6b. QUICKBOOKS RECONCILIATION REPORT (PDF) — for the Reconcile feature
  // ==========================================================================
  // QuickBooks Online's own per-account "Reconciliation Report" — a
  // genuinely different shape from a bank statement: Date / Type / Ref No.
  // / Payee / Amount, split across "Checks and payments cleared", "Deposits
  // and other credits cleared", and "Uncleared ..." sections. These print
  // as image-only PDFs (a browser print-to-PDF), so this always runs OCR.

  const RECON_SECTION_TITLES = [
    { re: /checks?\s+and\s+payments?\s+cleared/i, cleared: true },
    { re: /deposits?\s+and\s+other\s+credits?\s+cleared/i, cleared: true },
    { re: /uncleared\s+checks?\s+and\s+payments?/i, cleared: false },
    { re: /uncleared\s+deposits?\s+and\s+other\s+credits?/i, cleared: false },
  ];

  function isReconTableHeaderRow(row) {
    const t = row.text.toUpperCase();
    return t.includes('DATE') && t.includes('TYPE') && (t.includes('PAYEE') || t.includes('AMOUNT'));
  }

  async function parseQboReconciliationPdf(file, log) {
    if (log) log(`Reading ${file.name} (scanned reconciliation report — running OCR)...`);
    const rows = await ocrExtractRows(file, log);

    let company = '';
    let accountLine = '';
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const t = rows[i].text.trim();
      if (!t) continue;
      if (!company && !/reconciliation report|period ending/i.test(t)) { company = t; continue; }
      if (!accountLine && /period ending/i.test(t)) { accountLine = t; break; }
    }
    const periodMatch = accountLine.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);

    let beginningBalance = null;
    let endingBalance = null;
    for (const row of rows) {
      const pairs = extractLabelValuePairs(row);
      for (const { label, value } of pairs) {
        if (value === null) continue;
        if (/statement beginning balance/i.test(label)) beginningBalance = value;
        else if (/statement ending balance/i.test(label)) endingBalance = value;
      }
    }

    const transactions = [];
    let currentSection = null; // { cleared: bool, label: string }
    let current = null; // in-progress transaction accumulator

    function flushCurrent() {
      if (current && current.dateText && current.amount !== null && current.amount !== 0) {
        transactions.push({
          date: current.dateText,
          dateISO: mdyToISO(current.dateText),
          description: current.descParts.join(' ').replace(/\s+/g, ' ').trim() || '(no description)',
          type: current.amount < 0 ? 'Debit' : 'Credit',
          amount: current.amount,
          balance: null,
          section: currentSection ? currentSection.label : '',
          signSource: 'reconciliation-report',
        });
      }
      current = null;
    }

    function mdyToISO(mdy) {
      const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (!m) return '';
      let [, mm, dd, yy] = m;
      if (yy.length === 2) yy = (Number(yy) > 70 ? '19' : '20') + yy;
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    for (const row of rows) {
      const t = row.text.trim();
      if (!t) continue;

      const sectionMatch = RECON_SECTION_TITLES.find((s) => s.re.test(t));
      if (sectionMatch) {
        flushCurrent();
        currentSection = { cleared: sectionMatch.cleared, label: t.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+as of.*$/i, '').replace(/\s+after.*$/i, '').trim() };
        continue;
      }
      if (isReconTableHeaderRow(row)) { flushCurrent(); continue; }
      if (/^total\b/i.test(t)) { flushCurrent(); continue; }

      const dateItem = row.items.find((it) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(it.text.trim()));
      const amountItems = row.items.filter((it) => isAmountToken(it.text));

      if (dateItem) {
        flushCurrent();
        const rest = row.items.filter((it) => it !== dateItem && !amountItems.includes(it));
        current = {
          dateText: dateItem.text.trim(),
          descParts: rest.map((it) => it.text),
          amount: amountItems.length ? parseAmount(amountItems[amountItems.length - 1].text) : null,
        };
      } else if (current) {
        // Continuation of a truncated/wrapped payee name, or the amount
        // landed on its own row.
        if (amountItems.length && current.amount === null) {
          current.amount = parseAmount(amountItems[amountItems.length - 1].text);
        }
        const textItems = row.items.filter((it) => !amountItems.includes(it));
        current.descParts.push(...textItems.map((it) => it.text));
      }
    }
    flushCurrent();

    const summary = {
      fileName: file.name,
      bank: 'QuickBooks Reconciliation Report',
      accountHolder: company,
      accountNumber: '',
      period: periodMatch ? periodMatch[1] : '',
      beginningBalance,
      endingBalance,
      statedCredits: null,
      statedDebits: null,
      computedCredits: round2(transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)),
      computedDebits: round2(transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)),
      creditsMatch: null,
      debitsMatch: null,
      transactionCount: transactions.length,
      sectionsDetected: new Set(transactions.map((t) => t.section)).size,
      recognizedFromMemory: [],
      autoCorrected: [],
      newlyLearned: 0,
      usedOcr: true,
      sourceFormat: 'reconciliation-pdf',
    };
    return { summary, transactions };
  }

  async function ocrExtractRows(file, onProgress) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const worker = await getOcrWorker(onProgress);
    const allRows = [];
    const SCALE = 3; // ~216 DPI from a 72-DPI PDF page; a good accuracy/speed balance

    for (let p = 1; p <= pdf.numPages; p++) {
      if (onProgress) onProgress(`  OCR: reading page ${p} of ${pdf.numPages}...`);
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data } = await worker.recognize(canvas);
      allRows.push(...ocrResultToRows(data, p, canvas.height));
      canvas.width = 0;
      canvas.height = 0; // release memory promptly
    }
    return allRows;
  }

  // ==========================================================================
  // 7. QBO / OFX GENERATION
  // ==========================================================================
  // Writes QuickBooks Web Connect (.qbo) files in OFX 1.0.2 SGML form — the
  // dialect QuickBooks Desktop actually accepts. Handles both bank accounts
  // (BANKMSGSRSV1 / STMTRS / BANKACCTFROM) and credit cards
  // (CREDITCARDMSGSRSV1 / CCSTMTRS / CCACCTFROM).
  //
  // The fussy parts, all of which QuickBooks will reject a file over:
  //   * FITID must be unique per transaction and stable across re-imports,
  //     or QuickBooks silently drops rows as duplicates.
  //   * Text must be plain ASCII with XML entities escaped; NAME is capped
  //     at 32 chars and MEMO at 255.
  //   * BANKID (routing) must be exactly 9 digits for bank accounts.
  //   * ACCTTYPE and TRNTYPE must come from the OFX-defined vocabularies.

  const VALID_ACCTTYPES = ['CHECKING', 'SAVINGS', 'MONEYMRKT', 'CREDITLINE', 'CREDITCARD'];
  const VALID_TRNTYPES = new Set([
    'CREDIT', 'DEBIT', 'CHECK', 'ATM', 'POS', 'OTHER', 'XFER', 'DEP', 'DIRECTDEP',
    'DIRECTDEBIT', 'FEE', 'INT', 'DIV', 'SRVCHG', 'PAYMENT', 'CASH', 'REPEATPMT',
  ]);

  // Published ACH routing numbers, used only to pre-fill the metadata form so
  // the field isn't blank. Always editable by the user before export.
  const DEFAULT_ROUTINGS = {
    'chase': '021000021', 'jpmorgan chase': '021000021', 'bank of america': '026009593',
    'wells fargo': '121000248', 'citibank': '021000089', 'us bank': '123000220',
    'capital one': '065000090', 'td bank': '031101266', 'pnc bank': '043000096',
    'hsbc': '022000020', 'm&t bank': '022000046', 'truist': '053101121',
    'keybank': '021300077', 'huntington': '044000024', 'discover': '031176110',
    'american express': '124085066', 'citizens bank': '011500120',
    'regions bank': '062005690', 'santander': '231372691', 'ally bank': '124003116',
    'fifth third': '042000314', 'navy federal': '256074974', 'connectone bank': '021205871',
    'hanover bank': '021213944', 'amboy bank': '021207561',
  };

  function digitsOnly(s) {
    return String(s == null ? '' : s).replace(/\D/g, '');
  }

  function alnumOnly(s) {
    return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '');
  }

  // Strip to printable ASCII and escape the three XML-significant characters.
  // OFX 1.x is SGML, so an unescaped "&" or "<" in a merchant name is enough
  // to make QuickBooks reject the whole file.
  function asciiClean(s) {
    let t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');
    t = t.replace(/[^\x20-\x7E]/g, '');
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  }

  function ofxNameTrim(s, n) {
    const t = asciiClean(s);
    return (t ? t.slice(0, n || 32) : 'TRANSACTION');
  }

  function ofxMemo(s) {
    return asciiClean(s).slice(0, 255);
  }

  function fmtOfxAmount(a) {
    return Number(a || 0).toFixed(2);
  }

  function isoToYYYYMMDD(iso) {
    const d = digitsOnly(iso);
    return d.length >= 8 ? d.slice(0, 8) : '';
  }

  function defaultRoutingFor(bank) {
    const key = String(bank || '').toLowerCase().trim();
    if (DEFAULT_ROUTINGS[key]) return DEFAULT_ROUTINGS[key];
    for (const k of Object.keys(DEFAULT_ROUTINGS)) {
      if (key.includes(k) || k.includes(key)) return DEFAULT_ROUTINGS[k];
    }
    return '';
  }

  function sanitizeQboMetadata(md) {
    const isCC = String(md.account_type || '').toUpperCase() === 'CREDITCARD';
    let acctType = String(md.account_type || 'CHECKING').toUpperCase();
    if (VALID_ACCTTYPES.indexOf(acctType) === -1) acctType = 'CHECKING';

    let routing = digitsOnly(md.routing_number);
    if (!isCC) {
      if (routing.length > 9) routing = routing.slice(0, 9);
      else if (routing.length && routing.length < 9) routing = routing.padStart(9, '0');
      else if (!routing.length) routing = '000000000';
    }

    return {
      bank_name: asciiClean(md.bank_name || 'BANK').slice(0, 32) || 'BANK',
      routing_number: routing,
      account_number: alnumOnly(md.account_number) || '12345',
      account_type: acctType,
      company_name: alnumOnly(md.company_name).slice(0, 32) || 'COMPANY',
      start_date: isoToYYYYMMDD(md.start_date),
      end_date: isoToYYYYMMDD(md.end_date),
      ending_balance: Number(md.ending_balance) || 0,
    };
  }

  // Returns a list of human-readable problems that would make QuickBooks
  // reject the file. Shown in the UI before export rather than producing a
  // .qbo that silently fails to import.
  function validateQboMetadata(md) {
    const errs = [];
    const isCC = String(md.account_type || '').toUpperCase() === 'CREDITCARD';
    if (!isCC) {
      const routing = digitsOnly(md.routing_number);
      if (!routing) errs.push('Routing number is required for bank accounts.');
      else if (routing.length !== 9) errs.push(`Routing number must be exactly 9 digits (got ${routing.length}).`);
    }
    if (!alnumOnly(md.account_number)) errs.push('Account number is required.');
    const s = isoToYYYYMMDD(md.start_date);
    const e = isoToYYYYMMDD(md.end_date);
    if (s.length !== 8) errs.push('Start date must be YYYYMMDD (8 digits).');
    if (e.length !== 8) errs.push('End date must be YYYYMMDD (8 digits).');
    if (s.length === 8 && e.length === 8 && s > e) errs.push('Start date is after end date.');
    return errs;
  }

  function resolveTrnType(txn) {
    const explicit = String(txn.qboType || '').toUpperCase();
    if (VALID_TRNTYPES.has(explicit)) return explicit;
    if (/check/i.test(txn.section || '') || /^check\s*#?\s*\d+/i.test(txn.description || '')) return 'CHECK';
    return Number(txn.amount) > 0 ? 'CREDIT' : 'DEBIT';
  }

  function generateQBO(metadata, transactions) {
    const md = sanitizeQboMetadata(metadata);
    const isCC = md.account_type === 'CREDITCARD';
    const out = [
      'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE',
      'ENCODING:USASCII', 'CHARSET:1252', 'COMPRESSION:NONE',
      'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    ];

    const stamp = (md.end_date || '20250101') + '120000';
    out.push(
      '<OFX>', '<SIGNONMSGSRSV1>', '<SONRS>', '<STATUS>',
      '<CODE>0', '<SEVERITY>INFO', '</STATUS>',
      `<DTSERVER>${stamp}`, '<LANGUAGE>ENG',
      '<FI>', `<ORG>${md.bank_name}`, '<FID>3000', '</FI>',
      '<INTU.BID>3000',
      '</SONRS>', '</SIGNONMSGSRSV1>'
    );

    if (isCC) {
      out.push(
        '<CREDITCARDMSGSRSV1>', '<CCSTMTTRNRS>', '<TRNUID>1',
        '<STATUS>', '<CODE>0', '<SEVERITY>INFO', '</STATUS>',
        '<CCSTMTRS>', '<CURDEF>USD',
        '<CCACCTFROM>', `<ACCTID>${md.account_number}`, '</CCACCTFROM>'
      );
    } else {
      out.push(
        '<BANKMSGSRSV1>', '<STMTTRNRS>', '<TRNUID>1',
        '<STATUS>', '<CODE>0', '<SEVERITY>INFO', '</STATUS>',
        '<STMTRS>', '<CURDEF>USD',
        '<BANKACCTFROM>',
        `<BANKID>${md.routing_number}`,
        `<ACCTID>${md.account_number}`,
        `<ACCTTYPE>${md.account_type}`, '</BANKACCTFROM>'
      );
    }

    out.push('<BANKTRANLIST>', `<DTSTART>${(md.start_date || '20250101')}120000`, `<DTEND>${(md.end_date || '20250101')}120000`);

    // FITID: derived from account + amount + date + a per-date sequence, so
    // re-exporting the same statement produces identical IDs (QuickBooks
    // won't double-import) while two genuinely different transactions on the
    // same day for the same amount still get distinct IDs.
    const seqByDate = Object.create(null);
    const seen = Object.create(null);
    let written = 0;

    for (const txn of transactions) {
      const date = isoToYYYYMMDD(txn.dateISO || txn.date);
      if (date.length !== 8) continue;
      const amount = Number(txn.amount);
      if (!isFinite(amount)) continue;

      seqByDate[date] = (seqByDate[date] || 0) + 1;
      const seq = String(seqByDate[date]).padStart(3, '0');
      const base = alnumOnly(`${md.account_number}${fmtOfxAmount(amount).replace('.', '').replace('-', 'N')}${date}${seq}`);
      let fitid = base;
      let bump = 0;
      while (seen[fitid]) {
        bump++;
        fitid = `${base}${String(bump).padStart(2, '0')}`;
      }
      seen[fitid] = true;

      const desc = txn.description || '';
      out.push(
        '<STMTTRN>', `<TRNTYPE>${resolveTrnType(txn)}`,
        `<DTPOSTED>${date}120000`, `<TRNAMT>${fmtOfxAmount(amount)}`,
        `<FITID>${fitid}`, `<NAME>${ofxNameTrim(desc, 32)}`,
        `<MEMO>${ofxMemo(desc)}`, '</STMTTRN>'
      );
      written++;
    }

    out.push(
      '</BANKTRANLIST>', '<LEDGERBAL>',
      `<BALAMT>${fmtOfxAmount(md.ending_balance)}`,
      `<DTASOF>${(md.end_date || '20250101')}120000`, '</LEDGERBAL>'
    );

    if (isCC) out.push('</CCSTMTRS>', '</CCSTMTTRNRS>', '</CREDITCARDMSGSRSV1>');
    else out.push('</STMTRS>', '</STMTTRNRS>', '</BANKMSGSRSV1>');

    out.push('</OFX>');
    return { text: out.join('\r\n') + '\r\n', written };
  }

  // Build the editable metadata block that drives QBO export, seeded from
  // whatever the statement parser already worked out.
  function deriveQboMetadata(summary, transactions) {
    const dates = transactions.map((t) => isoToYYYYMMDD(t.dateISO || t.date)).filter((d) => d.length === 8).sort();
    const range = periodToRange({ text: summary.period || '' });
    const fromRange = (p) => (p ? `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}` : '');
    return {
      bank_name: summary.bank || '',
      account_number: alnumOnly(summary.accountNumber) || '',
      account_type: VALID_ACCTTYPES.indexOf(summary.ofxAcctType) !== -1
        ? summary.ofxAcctType
        : (summary.isCreditCard ? 'CREDITCARD' : 'CHECKING'),
      routing_number: digitsOnly(summary.ofxRouting) || defaultRoutingFor(summary.bank),
      company_name: summary.accountHolder || '',
      start_date: fromRange(range.start) || (dates.length ? dates[0] : ''),
      end_date: fromRange(range.end) || (dates.length ? dates[dates.length - 1] : ''),
      ending_balance: summary.endingBalance == null ? 0 : summary.endingBalance,
    };
  }

  // ==========================================================================
  // 7b. EXCEL / CSV IMPORT  (spreadsheet -> transactions -> QBO)
  // ==========================================================================
  // Accepts a spreadsheet this tool previously exported, or any third-party
  // export, and turns it back into transactions. Nothing about the column
  // order is assumed: the header row is located by scanning for the row that
  // best matches known column names, then columns are mapped by keyword. That
  // means it reads its own "All Transactions" sheet and a bank's own
  // downloaded CSV equally well.

  const XL_DATE_KEYS = ['date', 'transdate', 'postdate', 'posted', 'postingdate', 'transactiondate', 'datepasted', 'dateposted'];
  const XL_AMOUNT_KEYS = ['amount', 'amt', 'value'];
  const XL_DEBIT_KEYS = ['debit', 'withdrawal', 'withdrawals', 'payment', 'paymentsanddebits', 'moneyout'];
  const XL_CREDIT_KEYS = ['credit', 'deposit', 'deposits', 'depositsandcredits', 'moneyin'];
  const XL_DESC_KEYS = ['description', 'desc', 'details', 'memo', 'narrative', 'payee', 'merchant', 'transactiondescription', 'name'];
  const XL_TYPE_KEYS = ['type', 'trntype', 'transactiontype', 'drcr'];
  const XL_CHECK_KEYS = ['check', 'checkno', 'checknum', 'checknumber', 'serial', 'serialno'];
  const XL_BALANCE_KEYS = ['balance', 'runningbalance', 'ledgerbalance', 'endingbalance'];
  const XL_BANK_KEYS = ['bank', 'bankname', 'institution'];
  const XL_ACCTNO_KEYS = ['accountnumber', 'accountno', 'acctnumber', 'acctno', 'account'];
  const XL_HOLDER_KEYS = ['accountholder', 'holder', 'companyname', 'accountowner'];

  function normKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function matchesKey(header, keys) {
    const h = normKey(header);
    if (!h) return false;
    return keys.some((k) => h === k) || keys.some((k) => h.includes(k) && k.length >= 4);
  }

  function scoreHeaderRow(row) {
    let score = 0;
    let hasDate = false, hasMoney = false;
    for (const cell of row) {
      if (matchesKey(cell, XL_DATE_KEYS)) { score += 2; hasDate = true; }
      else if (matchesKey(cell, XL_AMOUNT_KEYS) || matchesKey(cell, XL_DEBIT_KEYS) || matchesKey(cell, XL_CREDIT_KEYS)) { score += 2; hasMoney = true; }
      else if (matchesKey(cell, XL_DESC_KEYS)) score += 1;
      else if (matchesKey(cell, XL_TYPE_KEYS) || matchesKey(cell, XL_CHECK_KEYS)) score += 1;
    }
    return hasDate && hasMoney ? score : 0;
  }

  function excelSerialToYYYYMMDD(n) {
    // Excel epoch: day 1 = 1900-01-01, with the historical 1900 leap-year bug.
    const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function cellToYYYYMMDD(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      return `${v.getUTCFullYear()}${String(v.getUTCMonth() + 1).padStart(2, '0')}${String(v.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof v === 'number' && v > 20000 && v < 60000) return excelSerialToYYYYMMDD(v);
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
    if (m) {
      let y = parseInt(m[3], 10);
      if (y < 100) y += y < 50 ? 2000 : 1900;
      return `${y}${m[1].padStart(2, '0')}${m[2].padStart(2, '0')}`;
    }
    if (/^\d{8}$/.test(s)) return s;
    const worded = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?/);
    if (worded && MONTHS[worded[1].toLowerCase()]) {
      const y = worded[3] || new Date().getFullYear();
      return `${y}${String(MONTHS[worded[1].toLowerCase()]).padStart(2, '0')}${worded[2].padStart(2, '0')}`;
    }
    return '';
  }

  function cellToNumber(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    return parseAmount(String(v));
  }

  async function parseSpreadsheet(file, log) {
    log(`Reading ${file.name}...`);
    const buf = await file.arrayBuffer();
    const isCsv = /\.csv$/i.test(file.name);
    const wb = isCsv
      ? XLSX.read(new TextDecoder().decode(buf), { type: 'string' })
      : XLSX.read(buf, { type: 'array', cellDates: true });

    // Prefer a sheet that actually looks like a transaction table; a workbook
    // exported by this tool has a summary sheet and per-statement sheets too.
    let best = null;
    for (const sheetName of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '' });
      if (!grid.length) continue;
      for (let i = 0; i < Math.min(grid.length, 25); i++) {
        const score = scoreHeaderRow(grid[i] || []);
        if (score > 0 && (!best || score > best.score)) {
          best = { sheetName, grid, headerIdx: i, score };
        }
      }
    }
    if (!best) throw new Error('No transaction table found — need at least a date column and an amount (or debit/credit) column.');

    const header = best.grid[best.headerIdx].map((h) => String(h == null ? '' : h));
    const col = {};
    header.forEach((h, idx) => {
      if (col.date === undefined && matchesKey(h, XL_DATE_KEYS)) col.date = idx;
      else if (col.credit === undefined && matchesKey(h, XL_CREDIT_KEYS)) col.credit = idx;
      else if (col.debit === undefined && matchesKey(h, XL_DEBIT_KEYS)) col.debit = idx;
      else if (col.amount === undefined && matchesKey(h, XL_AMOUNT_KEYS)) col.amount = idx;
      else if (col.desc === undefined && matchesKey(h, XL_DESC_KEYS)) col.desc = idx;
      else if (col.type === undefined && matchesKey(h, XL_TYPE_KEYS)) col.type = idx;
      else if (col.check === undefined && matchesKey(h, XL_CHECK_KEYS)) col.check = idx;
      else if (col.balance === undefined && matchesKey(h, XL_BALANCE_KEYS)) col.balance = idx;
      else if (col.bank === undefined && matchesKey(h, XL_BANK_KEYS)) col.bank = idx;
      else if (col.acctNo === undefined && matchesKey(h, XL_ACCTNO_KEYS)) col.acctNo = idx;
      else if (col.holder === undefined && matchesKey(h, XL_HOLDER_KEYS)) col.holder = idx;
    });

    // Account identity, if the sheet carries it — taken from the first row
    // that has a value, since it's repeated on every row.
    const firstVal = (idx) => {
      if (idx === undefined) return '';
      for (let r = best.headerIdx + 1; r < best.grid.length; r++) {
        const v = String((best.grid[r] || [])[idx] || '').trim();
        if (v) return v;
      }
      return '';
    };
    const sheetBank = firstVal(col.bank);
    const sheetAcctNo = firstVal(col.acctNo);
    const sheetHolder = firstVal(col.holder);

    const transactions = [];
    for (let r = best.headerIdx + 1; r < best.grid.length; r++) {
      const row = best.grid[r] || [];
      if (!row.length) continue;
      const dateStr = cellToYYYYMMDD(col.date !== undefined ? row[col.date] : '');
      if (!dateStr) continue;

      let amount = null;
      if (col.amount !== undefined) amount = cellToNumber(row[col.amount]);
      if (amount === null && (col.credit !== undefined || col.debit !== undefined)) {
        const c = col.credit !== undefined ? cellToNumber(row[col.credit]) : null;
        const d = col.debit !== undefined ? cellToNumber(row[col.debit]) : null;
        if (c) amount = Math.abs(c);
        else if (d) amount = -Math.abs(d);
      }
      if (amount === null || !isFinite(amount)) continue;

      // A "Type" column wins over the raw sign when the two disagree, since
      // plenty of exports list debits as positive numbers in a Debit column.
      const typeStr = col.type !== undefined ? String(row[col.type] || '').toUpperCase() : '';
      if (/DEBIT|WITHDRAW|^DR$/.test(typeStr) && amount > 0) amount = -amount;
      else if (/CREDIT|DEPOSIT|^CR$/.test(typeStr) && amount < 0) amount = Math.abs(amount);

      let desc = col.desc !== undefined ? String(row[col.desc] || '').trim() : '';
      const checkNo = col.check !== undefined ? String(row[col.check] || '').trim() : '';
      if (checkNo && !desc) desc = `Check #${checkNo}`;
      else if (checkNo && !desc.includes(checkNo)) desc = `Check #${checkNo} — ${desc}`;
      if (!desc) desc = '(no description)';

      const balance = col.balance !== undefined ? cellToNumber(row[col.balance]) : null;
      const isCheck = /CHECK/.test(typeStr) || !!checkNo;

      transactions.push({
        date: `${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}/${dateStr.slice(0, 4)}`,
        dateISO: `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`,
        description: desc,
        type: amount < 0 ? 'Debit' : 'Credit',
        amount,
        balance: balance === null ? null : balance,
        section: isCheck ? 'Checks' : amount < 0 ? 'Withdrawals' : 'Deposits',
        signSource: 'spreadsheet',
        qboType: isCheck ? 'CHECK' : undefined,
      });
    }

    transactions.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

    const computedCredits = round2(transactions.filter((t) => t.type === 'Credit').reduce((s, t) => s + t.amount, 0));
    const computedDebits = round2(transactions.filter((t) => t.type === 'Debit').reduce((s, t) => s + Math.abs(t.amount), 0));
    const bySection = {};
    for (const tx of transactions) (bySection[tx.section] = bySection[tx.section] || []).push(tx);

    const summary = {
      fileName: file.name,
      bank: sheetBank || detectBankFromFileName(file.name),
      accountHolder: sheetHolder,
      accountNumber: sheetAcctNo,
      period: transactions.length ? `${transactions[0].date} to ${transactions[transactions.length - 1].date}` : '(not detected)',
      beginningBalance: null,
      endingBalance: transactions.length && transactions[transactions.length - 1].balance != null
        ? transactions[transactions.length - 1].balance
        : null,
      statedCredits: null,
      statedDebits: null,
      computedCredits,
      computedDebits,
      creditsMatch: null,
      debitsMatch: null,
      transactionCount: transactions.length,
      sectionsDetected: Object.keys(bySection).length,
      recognizedFromMemory: [],
      autoCorrected: [],
      newlyLearned: 0,
      sourceFormat: 'spreadsheet',
      sourceSheet: best.sheetName,
    };

    log(`  → ${transactions.length} transactions read from sheet "${best.sheetName}"`);
    return { summary, transactions };
  }

  // ==========================================================================
  // 7c. VENDOR / CATEGORY PIVOT
  // ==========================================================================
  // Groups transactions by a cleaned-up vendor name and by spending category,
  // for both bank and credit-card statements — same transaction shape either
  // way, so no separate logic is needed per statement type.

  // Known merchants whose raw description varies a lot (reference numbers,
  // store IDs, city/state) but should always roll up to one canonical name.
  // Checked before the generic stripping fallback, in order.
  const KNOWN_VENDOR_PATTERNS = [
    [/\bamazon\b|\bamzn\b|\bamz\s*mrk\b|\bamz\*/i, 'Amazon'],
    [/\bwal-?mart\b/i, 'Walmart'],
    [/\btarget\b/i, 'Target'],
    [/\bcostco\b/i, 'Costco'],
    [/\bdoordash\b/i, 'DoorDash'],
    [/\bgrubhub\b/i, 'Grubhub'],
    [/\buber\s*eats\b/i, 'Uber Eats'],
    [/\buber\b/i, 'Uber'],
    [/\blyft\b/i, 'Lyft'],
    [/\bstarbucks\b/i, 'Starbucks'],
    [/\bmcdonald/i, "McDonald's"],
    [/\bapple\.com|\bapple\s/i, 'Apple'],
    [/\bgoogle\b|\*blinq\b/i, 'Google'],
    [/\bmicrosoft\b/i, 'Microsoft'],
    [/\bnetflix\b/i, 'Netflix'],
    [/\bspotify\b/i, 'Spotify'],
    [/\bpeacock\b/i, 'Peacock'],
    [/\bhulu\b/i, 'Hulu'],
    [/\bhbo\b|\bmax\.com\b/i, 'Max'],
    [/\bparamount\+|\bparamount plus\b/i, 'Paramount+'],
    [/\bespn\+|\bespn plus\b/i, 'ESPN+'],
    [/\byoutube\s*(premium|tv)?\b/i, 'YouTube'],
    [/\baudible\b/i, 'Audible'],
    [/\badobe\b/i, 'Adobe'],
    [/\bpaypal\b/i, 'PayPal'],
    [/\bzelle\b/i, 'Zelle'],
    [/\bvenmo\b/i, 'Venmo'],
    [/\bsteamgames\b|\bsteam\b/i, 'Steam'],
    [/\bshell\b/i, 'Shell'],
    [/\bchevron\b/i, 'Chevron'],
    [/\bexxon\b/i, 'Exxon'],
    [/\bsunoco\b/i, 'Sunoco'],
    [/\bshoprite\b/i, 'ShopRite'],
    [/\bstop\s*&\s*shop\b/i, 'Stop & Shop'],
    [/\bcvs\b/i, 'CVS Pharmacy'],
    [/\bwalgreens\b/i, 'Walgreens'],
    [/\bhome depot\b/i, 'Home Depot'],
    [/\bblue cross\b/i, 'Blue Cross'],
    [/\bgeico\b/i, 'Geico'],
    [/\bstate farm\b/i, 'State Farm'],
    [/\bamerican(?:\s+airlines)?\b.*\bairport code\b|\bamerican\s+00\d+/i, 'American Airlines'],
    [/\bdelta\b/i, 'Delta Air Lines'],
    [/\bsouthwest\b/i, 'Southwest Airlines'],
    [/\bnycdot\s*parknyc\b|\bparknyc\b/i, 'NYC Parking (ParkNYC)'],
    [/\bez[- ]?pass\b/i, 'E-ZPass'],
    [/\bcheck\s*#?\s*\d+\b|^\d+\s+check\b/i, 'Check Payment'],
    [/\boverdraft fee\b/i, 'Overdraft Fee'],
    [/\btransaction(?:s)? fee\b/i, 'Account Fee'],
    [/\binternational transaction fee\b/i, 'International Transaction Fee'],
    [/\bmobile deposit\b/i, 'Mobile Deposit'],
    [/\bonline transfer\b/i, 'Online Transfer'],
    [/\brocket money\b/i, 'Rocket Money'],
    [/\bring\.com\b|\bring basic\b/i, 'Ring'],
    [/\breventure\b/i, 'Reventure'],
    [/\bvoxist\b/i, 'Voxist'],
    [/\boptimum\b/i, 'Optimum'],
    [/\bdisney\s*plus\b/i, 'Disney+'],
  ];

  // Noise that appears inside otherwise-useful descriptions and should be
  // stripped before taking the leading words as a vendor name: reference
  // numbers, authorization dates, card numbers, phone numbers, long digit
  // runs (store/merchant IDs), and trailing state abbreviations.
  const VENDOR_NOISE_RE = [
    /\bpurchase authorized on \d{2}\/\d{2}\b/gi,
    /\brecurring payment authorized on \d{2}\/\d{2}\b/gi,
    /\bauthorized on \d{2}\/\d{2}\b/gi,
    /\bref(?:erence)?\s*#?\s*[\w:]+\b/gi,
    /\bcard\s*\d{3,4}\b/gi,
    /\b\d{3}-\d{3}-\d{4}\b/g,
    /\b1?[- ]?800[- ]?[\w-]+\b/gi,
    /\bs\d{8,}\b/gi,
    /\b\d{10,}\b/g,
    /\b[A-Z]{2}\d{5,}\b/g,
    /\*/g,
  ];

  // A common product tier/plan word appended after the real vendor name
  // (e.g. "Peacock Premium", "Hulu Basic") — different customers, or the
  // same customer on different plans over time, shouldn't fragment into
  // separate vendor groups over this.
  const PLAN_TIER_WORDS = /^(premium|plus|pro|basic|standard|deluxe|monthly|annual|yearly|trial|lite|max|essential|family|individual)$/i;

  // A short token that mixes letters and digits with a high digit ratio (or
  // no vowels at all) reads as a random transaction/subscription ID rather
  // than a real word — e.g. "D827b", "2f20a", "X6714". Left in, each
  // transaction's unique ID makes an otherwise-identical vendor look like a
  // different one every time. This is a general heuristic, not a per-vendor
  // patch, so it should also help with services not explicitly listed below.
  function looksLikeRandomIdToken(word) {
    const w = word.replace(/[^a-z0-9]/gi, '');
    if (w.length < 4 || w.length > 10) return false;
    const hasDigit = /\d/.test(w);
    const hasLetter = /[a-z]/i.test(w);
    if (!hasDigit || !hasLetter) return false;
    const digitCount = (w.match(/\d/g) || []).length;
    const vowelCount = (w.match(/[aeiou]/gi) || []).length;
    return vowelCount === 0 || digitCount / w.length >= 0.25;
  }

  function normalizeVendorName(rawDescription) {
    const desc = String(rawDescription || '').trim();
    if (!desc) return 'Unknown';
    for (const [re, name] of KNOWN_VENDOR_PATTERNS) {
      if (re.test(desc)) return name;
    }
    let t = desc;
    for (const re of VENDOR_NOISE_RE) t = t.replace(re, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    // Take the first few meaningful words as the vendor name — skipping any
    // that look like a random ID or a plan-tier suffix — since a long tail
    // of address/city text (or a per-transaction ID) after that isn't part
    // of the merchant's identity.
    const words = t.split(' ').filter((w) => w.length > 0 && !looksLikeRandomIdToken(w) && !PLAN_TIER_WORDS.test(w));
    let name = words.slice(0, 3).join(' ');
    if (!name) name = desc.slice(0, 30);
    // Title-case for readability, but keep short all-caps words (like "LLC") as-is.
    name = name.replace(/\w+/g, (w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()));
    return name.slice(0, 40);
  }

  const CATEGORY_RULES = [
    [/amazon|walmart|target\b|costco|ebay|shoprite|stop & shop|home depot|best buy|lowe'?s|kohl'?s|macy'?s|marshalls|tj\s*maxx|ikea|joyalukkas|jewelry/i, 'Shopping'],
    [/doordash|grubhub|uber eats|postmates|starbucks|mcdonald|wendy'?s|burger king|chipotle|dunkin|restaurant|tacobell|taco bell|coffee|pizza|kfc|subway|panera|chick-fil-a|cafe/i, 'Food & Dining'],
    [/\buber\b|lyft|parking|parknyc|e-zpass|ezpass|atm withdrawal|gas station|shell\b|chevron|exxon|sunoco|mobil\b|bp\b|76\b|circle k|speedway|airline|delta\b|southwest|jetblue|american\s*airlines|transit|metro\b|toll/i, 'Transportation'],
    [/google|apple\b|microsoft|netflix|spotify|adobe|steam\b|ring\b|reventure|voxist|disney\+|peacock|hulu|hbo|max\b|paramount\+|prime video|youtube|audible|dropbox|icloud|patreon|onlyfans|discord|slack|zoom\b|github|openai|chatgpt|subscription/i, 'Subscriptions & Software'],
    [/optimum|comcast|xfinity|spectrum|verizon|at&t|t-mobile|sprint\b|electric|con\s*ed|pg&e|gas company|water co|utilit|internet service|cable\b/i, 'Utilities'],
    [/blue cross|geico|state farm|allstate|progressive|insurance|metlife|aetna|cigna|humana/i, 'Insurance'],
    [/\bairport\b|hotel|marriott|hilton|airbnb|expedia|booking\.com|travel|resort/i, 'Travel'],
    [/overdraft fee|transaction fee|service charge|account fee|monthly fee|international transaction fee|maintenance fee|nsf fee|late fee|annual fee/i, 'Bank Fees'],
    [/zelle|venmo|paypal transfer|online transfer|wire transfer|cash app|western union/i, 'Transfers'],
    [/mobile deposit|payroll|direct deposit|deposit mobile banking|interest paid|dividend/i, 'Deposits & Income'],
    [/\bcheck payment\b|\bcheck #|\bcheck\s*\d+\b/i, 'Checks'],
    [/gym|fitness|planet fitness|equinox|peloton/i, 'Health & Fitness'],
    [/pharmacy|cvs\b|walgreens|rite aid|doctor|medical|dental|clinic|hospital/i, 'Medical & Healthcare'],
    [/rent\b|mortgage|hoa\b|property management/i, 'Housing'],
    [/tuition|school|university|college|student loan/i, 'Education'],
  ];

  function categorizeTransaction(vendor, description) {
    const hay = `${vendor} ${description}`;
    for (const [re, cat] of CATEGORY_RULES) {
      if (re.test(hay)) return cat;
    }
    return 'Uncategorized';
  }

  // Groups transactions by vendor or category. Each group carries its own
  // running count/total plus the full list of underlying transactions, so
  // the UI and export can both drill down to see exactly what rolled up
  // into that total — the same way an Excel pivot table's detail view works.
  function buildPivot(transactions, groupBy) {
    const groups = new Map();
    for (const tx of transactions) {
      const vendor = normalizeVendorName(tx.description);
      const key = groupBy === 'category' ? categorizeTransaction(vendor, tx.description) : vendor;
      if (!groups.has(key)) groups.set(key, { key, count: 0, total: 0, transactions: [] });
      const g = groups.get(key);
      g.count++;
      g.total = round2(g.total + tx.amount);
      g.transactions.push(tx);
    }
    return Array.from(groups.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }

  // Builds one worksheet with real Excel row grouping (an outline level per
  // row), so opening the file shows the same collapsible +/- controls a
  // native pivot table gives you — click a vendor's group to expand and see
  // every transaction rolled into that total, collapse to see just the
  // summary. SheetJS can't write an actual PivotTable object (that's a
  // proprietary cache format it doesn't support), but outlined groups are
  // functionally the same thing to open and use.
  function buildPivotSheet(groups, groupLabel) {
    const aoa = [[groupLabel, 'Transactions', 'Total Amount']];
    const rowLevels = [0];
    for (const g of groups) {
      aoa.push([g.key, g.count, g.total]);
      rowLevels.push(0);
      for (const tx of g.transactions) {
        aoa.push(['    ' + tx.date, tx.description, tx.amount]);
        rowLevels.push(1);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 34 }, { wch: 58 }, { wch: 14 }];
    ws['!outline'] = { above: false, left: false };
    ws['!rows'] = rowLevels.map((level) => (level > 0 ? { level, hidden: true } : { level }));
    return ws;
  }

  // ==========================================================================
  // 7d. BANK RECONCILIATION (two-sheet matching)
  // ==========================================================================
  // Matches transactions between two independently-sourced sheets (e.g. a
  // bank statement export vs. a books/QuickBooks export) the way an
  // accountant reconciles a bank account: by date and amount, never by
  // description text, since the two sides almost never describe the same
  // transaction the same way (a bank's raw ACH text vs. a books system's
  // vendor name).

  function dateDiffDays(isoA, isoB) {
    if (!isoA || !isoB) return Infinity;
    const a = new Date(isoA + 'T00:00:00Z').getTime();
    const b = new Date(isoB + 'T00:00:00Z').getTime();
    if (isNaN(a) || isNaN(b)) return Infinity;
    return Math.abs(a - b) / 86400000;
  }

  function reconcileTransactions(listA, listB, opts) {
    const dateTolerance = (opts && opts.dateTolerance) || 5;
    const amountTolerance = (opts && opts.amountTolerance) || 0.01;

    const a = listA.map((t, i) => ({ ...t, _id: 'a' + i, _used: false }));
    const b = listB.map((t, i) => ({ ...t, _id: 'b' + i, _used: false }));

    const matched = [];
    const mismatched = [];

    // Pass 1: exact amount match, closest date within tolerance, tightest
    // date difference wins first (so an exact-date match is always
    // preferred over a same-amount match several days away).
    const candidates = [];
    for (const ta of a) {
      for (const tb of b) {
        if (tb._used) continue;
        const amtDiff = Math.abs(ta.amount - tb.amount);
        const dDiff = dateDiffDays(ta.dateISO, tb.dateISO);
        if (amtDiff <= amountTolerance && dDiff <= dateTolerance) {
          candidates.push({ ta, tb, dDiff, amtDiff });
        }
      }
    }
    candidates.sort((x, y) => x.dDiff - y.dDiff || x.amtDiff - y.amtDiff);
    for (const c of candidates) {
      if (c.ta._used || c.tb._used) continue;
      c.ta._used = true;
      c.tb._used = true;
      matched.push({ a: c.ta, b: c.tb, dateDiffDays: c.dDiff });
    }

    // Pass 2: N:1 split detection — one side recorded a single transaction
    // that the other side split into several line items on the same date
    // (e.g. a combined bank deposit that books entered as two separate
    // customer payments). Only considered within a small same-date window,
    // and only when the split group's sum matches exactly, to avoid
    // guessing wrong.
    function trySplits(single, group, tag) {
      const bySingleId = new Map();
      const remaining = group.filter((t) => !t._used);
      for (const s of single) {
        if (s._used) continue;
        const nearby = remaining.filter((t) => !t._used && dateDiffDays(s.dateISO, t.dateISO) <= dateTolerance && Math.sign(t.amount) === Math.sign(s.amount));
        // Try combinations of 2 to 4 nearby items summing to the single amount.
        let found = null;
        for (let size = 2; size <= 4 && !found; size++) {
          found = findSubsetSum(nearby, size, s.amount, amountTolerance);
        }
        if (found) {
          s._used = true;
          found.forEach((t) => { t._used = true; });
          bySingleId.set(s._id, found);
        }
      }
      return bySingleId;
    }
    function findSubsetSum(items, size, target, tol) {
      const n = items.length;
      if (n < size) return null;
      const idx = Array.from({ length: size }, (_, i) => i);
      const tryCombo = (combo) => {
        const sum = combo.reduce((s, i) => s + items[i].amount, 0);
        return Math.abs(sum - target) <= tol ? combo.map((i) => items[i]) : null;
      };
      // Small N (bank/books batches are rarely huge), so a direct
      // combination scan is fine rather than needing a DP subset-sum.
      const combos = [];
      (function comb(start, chosen) {
        if (chosen.length === size) { combos.push(chosen.slice()); return; }
        for (let i = start; i < n; i++) { chosen.push(i); comb(i + 1, chosen); chosen.pop(); }
      })(0, []);
      for (const combo of combos) {
        const r = tryCombo(combo);
        if (r) return r;
      }
      return null;
    }

    const splitsAintoB = trySplits(a.filter((t) => !t._used), b.filter((t) => !t._used), 'a-split');
    for (const [singleId, group] of splitsAintoB) {
      const single = a.find((t) => t._id === singleId);
      matched.push({ a: single, b: group, split: 'b', dateDiffDays: 0 });
    }
    const splitsBintoA = trySplits(b.filter((t) => !t._used), a.filter((t) => !t._used), 'b-split');
    for (const [singleId, group] of splitsBintoA) {
      const single = b.find((t) => t._id === singleId);
      matched.push({ a: group, b: single, split: 'a', dateDiffDays: 0 });
    }

    // Pass 3: same-day, close-but-not-exact amount — likely the same
    // transaction with a discrepancy (a fee, a rounding difference, a
    // data-entry error) rather than two unrelated transactions. Flagged
    // separately from a clean match so it gets reviewed, not silently
    // treated as fine.
    const STOPWORDS = new Set(['the', 'and', 'inc', 'llc', 'ltd', 'corp', 'company', 'services', 'service', 'payment', 'payments', 'expense', 'deposit', 'check', 'credit', 'card', 'received', 'received-', 'receive']);
    function sharedMeaningfulWord(descA, descB) {
      const wordsOf = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []).values();
      const wa = [...wordsOf(descA)].filter((w) => !STOPWORDS.has(w));
      const wb = new Set([...wordsOf(descB)].filter((w) => !STOPWORDS.has(w)));
      return wa.some((w) => wb.has(w));
    }
    const mismatchCandidates = [];
    for (const ta of a) {
      if (ta._used) continue;
      for (const tb of b) {
        if (tb._used) continue;
        const dDiff = dateDiffDays(ta.dateISO, tb.dateISO);
        if (dDiff <= 2 && Math.sign(ta.amount) === Math.sign(tb.amount)) {
          mismatchCandidates.push({ ta, tb, dDiff, amtDiff: Math.abs(ta.amount - tb.amount) });
        }
      }
    }
    mismatchCandidates.sort((x, y) => x.amtDiff - y.amtDiff || x.dDiff - y.dDiff);
    for (const c of mismatchCandidates) {
      if (c.ta._used || c.tb._used) continue;
      // Only treat as a plausible mismatch — not two coincidentally-close
      // unrelated transactions — if the difference is a small fraction of
      // the amount (or a small flat, fee-sized amount) AND the two
      // descriptions actually share a real word (a vendor name, typically).
      // Closeness in date and amount alone isn't enough evidence; without
      // any textual link, presenting this as "the same transaction with a
      // discrepancy" would be a guess dressed up as a finding.
      const rel = c.amtDiff / Math.max(Math.abs(c.ta.amount), Math.abs(c.tb.amount), 1);
      const plausibleAmount = c.amtDiff <= 50 || rel <= 0.15;
      if (plausibleAmount && sharedMeaningfulWord(c.ta.description, c.tb.description)) {
        c.ta._used = true;
        c.tb._used = true;
        mismatched.push({ a: c.ta, b: c.tb, amountDiff: c.ta.amount - c.tb.amount, dateDiffDays: c.dDiff });
      }
    }

    const onlyA = a.filter((t) => !t._used);
    const onlyB = b.filter((t) => !t._used);

    return { matched, mismatched, onlyA, onlyB };
  }

  function buildReconciliationWorkbook(result, nameA, nameB) {
    const wb = XLSX.utils.book_new();
    const sumOf = (arr, key) => round2(arr.reduce((s, x) => s + (key ? x[key].amount : x.amount), 0));

    const summaryRows = [
      { Category: 'Matched', Count: result.matched.length, [`${nameA} Total`]: sumOf(result.matched.filter((m) => !m.split), 'a'), [`${nameB} Total`]: sumOf(result.matched.filter((m) => !m.split), 'b') },
      { Category: 'Amount Mismatches', Count: result.mismatched.length, [`${nameA} Total`]: sumOf(result.mismatched, 'a'), [`${nameB} Total`]: sumOf(result.mismatched, 'b') },
      { Category: `Only in ${nameA}`, Count: result.onlyA.length, [`${nameA} Total`]: round2(result.onlyA.reduce((s, x) => s + x.amount, 0)), [`${nameB} Total`]: 0 },
      { Category: `Only in ${nameB}`, Count: result.onlyB.length, [`${nameA} Total`]: 0, [`${nameB} Total`]: round2(result.onlyB.reduce((s, x) => s + x.amount, 0)) },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    autoWidth(wsSummary, summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    const matchedRows = [];
    for (const m of result.matched) {
      const aItems = Array.isArray(m.a) ? m.a : [m.a];
      const bItems = Array.isArray(m.b) ? m.b : [m.b];
      const n = Math.max(aItems.length, bItems.length);
      for (let i = 0; i < n; i++) {
        matchedRows.push({
          [`${nameA} Date`]: aItems[i] ? aItems[i].date : '', [`${nameA} Description`]: aItems[i] ? aItems[i].description : '', [`${nameA} Amount`]: aItems[i] ? aItems[i].amount : '',
          [`${nameB} Date`]: bItems[i] ? bItems[i].date : '', [`${nameB} Description`]: bItems[i] ? bItems[i].description : '', [`${nameB} Amount`]: bItems[i] ? bItems[i].amount : '',
          'Split': m.split ? `1 ${m.split === 'b' ? nameB : nameA} entry ↔ multiple ${m.split === 'b' ? nameB : nameA} entries` : '',
        });
      }
    }
    const wsMatched = XLSX.utils.json_to_sheet(matchedRows);
    autoWidth(wsMatched, matchedRows);
    XLSX.utils.book_append_sheet(wb, wsMatched, 'Matched');

    const mismatchRows = result.mismatched.map((m) => ({
      [`${nameA} Date`]: m.a.date, [`${nameA} Description`]: m.a.description, [`${nameA} Amount`]: m.a.amount,
      [`${nameB} Date`]: m.b.date, [`${nameB} Description`]: m.b.description, [`${nameB} Amount`]: m.b.amount,
      Difference: round2(m.amountDiff),
    }));
    const wsMismatch = XLSX.utils.json_to_sheet(mismatchRows);
    autoWidth(wsMismatch, mismatchRows);
    XLSX.utils.book_append_sheet(wb, wsMismatch, 'Amount Mismatches');

    const onlyARows = result.onlyA.map((t) => ({ Date: t.date, Description: t.description, Amount: t.amount }));
    const wsOnlyA = XLSX.utils.json_to_sheet(onlyARows);
    autoWidth(wsOnlyA, onlyARows);
    XLSX.utils.book_append_sheet(wb, wsOnlyA, `Only in ${nameA}`.slice(0, 31));

    const onlyBRows = result.onlyB.map((t) => ({ Date: t.date, Description: t.description, Amount: t.amount }));
    const wsOnlyB = XLSX.utils.json_to_sheet(onlyBRows);
    autoWidth(wsOnlyB, onlyBRows);
    XLSX.utils.book_append_sheet(wb, wsOnlyB, `Only in ${nameB}`.slice(0, 31));

    return wb;
  }

  function buildPivotWorkbook(transactions) {
    const wb = XLSX.utils.book_new();
    const byVendor = buildPivot(transactions, 'vendor');
    const byCategory = buildPivot(transactions, 'category');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byVendor, 'Vendor'), 'By Vendor');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byCategory, 'Category'), 'By Category');
    return wb;
  }

  // ==========================================================================
  // 8. EXCEL EXPORT
  // ==========================================================================

  function buildWorkbook(results) {
    const wb = XLSX.utils.book_new();

    const allRows = [];
    for (const r of results) {
      for (const tx of r.transactions) {
        allRows.push({
          'Source File': r.summary.fileName,
          Bank: r.summary.bank,
          'Account Holder': r.summary.accountHolder,
          'Account Number': r.summary.accountNumber,
          'Statement Period': r.summary.period,
          Date: tx.date,
          Description: tx.description,
          Type: tx.type,
          Amount: tx.amount,
          Balance: tx.balance == null ? '' : tx.balance,
          Section: tx.section,
        });
      }
    }
    const wsAll = XLSX.utils.json_to_sheet(allRows);
    autoWidth(wsAll, allRows);
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Transactions');

    const summaryRows = results.map((r) => ({
      'Source File': r.summary.fileName,
      Bank: r.summary.bank,
      'Account Holder': r.summary.accountHolder,
      'Account Number': r.summary.accountNumber,
      'Statement Period': r.summary.period,
      'Beginning Balance': r.summary.beginningBalance,
      'Ending Balance': r.summary.endingBalance,
      'Stated Total Credits': r.summary.statedCredits,
      'Computed Total Credits': r.summary.computedCredits,
      'Credits Match?': r.summary.creditsMatch === null ? 'N/A' : r.summary.creditsMatch ? 'YES' : 'CHECK',
      'Stated Total Debits': r.summary.statedDebits,
      'Computed Total Debits': r.summary.computedDebits,
      'Debits Match?': r.summary.debitsMatch === null ? 'N/A' : r.summary.debitsMatch ? 'YES' : 'CHECK',
      'Transaction Count': r.summary.transactionCount,
    }));
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    autoWidth(wsSummary, summaryRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Reconciliation Summary');

    const allTransactions = results.flatMap((r) => r.transactions);
    const byVendor = buildPivot(allTransactions, 'vendor');
    const byCategory = buildPivot(allTransactions, 'category');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byVendor, 'Vendor'), 'By Vendor');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byCategory, 'Category'), 'By Category');

    const usedNames = new Set(['All Transactions', 'Reconciliation Summary', 'By Vendor', 'By Category']);
    results.forEach((r, idx) => {
      const rows = r.transactions.map((tx) => ({
        Date: tx.date,
        Description: tx.description,
        Type: tx.type,
        Amount: tx.amount,
        Balance: tx.balance == null ? '' : tx.balance,
        Section: tx.section,
      }));
      let base = (r.summary.bank || 'Statement').replace(/[\\/?*[\]:]/g, '').slice(0, 20);
      let name = `${base} ${idx + 1}`.slice(0, 31);
      let n = 1;
      while (usedNames.has(name)) name = `${base} ${idx + 1}_${n++}`.slice(0, 31);
      usedNames.add(name);
      const ws = XLSX.utils.json_to_sheet(rows);
      autoWidth(ws, rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    });

    return wb;
  }

  function autoWidth(ws, rows) {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map((k) => {
      let max = k.length;
      for (const row of rows) {
        const v = row[k] == null ? '' : String(row[k]);
        if (v.length > max) max = v.length;
      }
      return { wch: Math.min(Math.max(max + 2, 10), 60) };
    });
  }

  // Includes the account identity on every row. It's redundant to read, but
  // it makes the sheet a lossless hand-off: re-importing it later still
  // knows which bank and account the rows belong to, so an exported .qbo
  // carries the right account number instead of a placeholder.
  function buildSingleWorkbook(result) {
    const s = result.summary;
    const rows = result.transactions.map((tx) => ({
      Date: tx.date,
      Description: tx.description,
      Type: tx.type,
      Amount: tx.amount,
      Balance: tx.balance == null ? '' : tx.balance,
      Section: tx.section,
      Bank: s.bank || '',
      'Account Number': s.accountNumber || '',
      'Account Holder': s.accountHolder || '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    autoWidth(ws, rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const byVendor = buildPivot(result.transactions, 'vendor');
    const byCategory = buildPivot(result.transactions, 'category');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byVendor, 'Vendor'), 'By Vendor');
    XLSX.utils.book_append_sheet(wb, buildPivotSheet(byCategory, 'Category'), 'By Category');
    return wb;
  }

  function buildCSV(transactions) {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = 'Date,Type,Description,Amount,Balance,Section\n';
    return head + transactions.map((t) =>
      [t.date, t.type, esc(t.description), t.amount, t.balance == null ? '' : t.balance, esc(t.section)].join(',')
    ).join('\n');
  }

  function buildCombinedCSV(results) {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = 'Source File,Bank,Date,Type,Description,Amount,Balance,Section\n';
    const rows = [];
    for (const r of results) {
      for (const t of r.transactions) {
        rows.push([esc(r.summary.fileName), esc(r.summary.bank), t.date, t.type, esc(t.description), t.amount, t.balance == null ? '' : t.balance, esc(t.section)].join(','));
      }
    }
    return head + rows.join('\n');
  }

  function downloadBlob(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function baseFileName(s) {
    return String(s || 'statement').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  }

  function kindOf(file) {
    if (/\.(qbo|qfx|ofx)$/i.test(file.name)) return 'ofx';
    if (/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) return 'sheet';
    return 'pdf';
  }
  async function parseAny(file, log) {
    const k = kindOf(file);
    const r = k === 'ofx' ? await parseQBO(file, log) : k === 'sheet' ? await parseSpreadsheet(file, log) : await parseStatement(file, log);
    r.metadata = deriveQboMetadata(r.summary, r.transactions);
    return r;
  }
  window.OBStatement = { extractRows, ocrExtractRows, ocrImageRows, parseAny, kindOf, setOcrEnabled, generateQBO, deriveQboMetadata, buildCSV, buildSingleWorkbook, buildPivotWorkbook, normalizeVendorName, categorizeTransaction, templateStats, clearTemplates, downloadBlob, baseFileName };
})();
