/* CSV Cleaner engine. Pure functions: no DOM, no network, no external libraries.
   Loaded by the page as a plain script file; it defines window.CsvCleaner.
   The file is pure ASCII (currency symbols and dashes are written as code point escapes),
   so it does not depend on the charset the server announces. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else if (typeof window !== 'undefined') { window.CsvCleaner = api; }
  else { root.CsvCleaner = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLUMNS = ['date', 'description', 'amount', 'currency', 'fee', 'net', 'reference', 'source'];

  var PROFILE_LABELS = {
    paypal: 'PayPal activity download',
    etsy_orders: 'Etsy sold orders',
    etsy_statement: 'Etsy monthly statement',
    bank: 'Generic bank export'
  };

  var DELIMITER_LABELS = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

  /* ---------- decoding ---------- */

  function decodeBytes(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16 LE' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16 BE' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      return {
        text: new TextDecoder('windows-1252').decode(bytes),
        encoding: 'Windows-1252 (the file was not valid UTF-8)'
      };
    }
  }

  /* ---------- CSV parsing ---------- */

  function isBlankText(s) { return s === '' || /^[ \t]*$/.test(s); }

  /* Returns { records: [{ line, cells }], unterminatedQuote }.
     `line` is the 1-based physical line where the record starts. A leading BOM is skipped.
     A quote opens a quoted field only at the start of a field (spaces before it are
     dropped) and only once per field; any other quote is kept as a literal character. */
  function parseCsv(text, delim) {
    var records = [], row = [], field = '', inQuote = false, wasQuoted = false;
    var line = 1, startLine = 1, i = 0, n = text.length, c, sawAny = false;
    if (text.charCodeAt(0) === 0xFEFF) { i = 1; }
    function endField() {
      row.push(field);
      field = '';
      wasQuoted = false;
    }
    function endRow() {
      endField();
      records.push({ line: startLine, cells: row });
      row = [];
      sawAny = false;
    }
    while (i < n) {
      c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuote = false; i++; continue;
        }
        if (c === '\r') {
          if (text[i + 1] === '\n') { i++; }
          field += '\n'; line++; i++; continue;
        }
        if (c === '\n') { line++; }
        field += c; i++; continue;
      }
      if (c === '"' && !wasQuoted && isBlankText(field)) {
        inQuote = true; wasQuoted = true; field = ''; sawAny = true; i++; continue;
      }
      if (c === delim) { endField(); sawAny = true; i++; continue; }
      if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') { i++; }
        endRow(); line++; startLine = line; i++; continue;
      }
      field += c; sawAny = true; i++;
    }
    if (sawAny || field !== '' || row.length) { endRow(); }
    return { records: records, unterminatedQuote: inQuote };
  }

  function isEmptyRecord(rec) {
    for (var i = 0; i < rec.cells.length; i++) {
      if (rec.cells[i].trim() !== '') { return false; }
    }
    return true;
  }

  /* Picks the delimiter that gives the most rows of the same width.
     An Excel "sep=;" first line wins outright. On an equal score the semicolon and
     the tab win over the comma, because a comma also appears inside the data of
     decimal-comma files (12,50) while a semicolon or a tab almost never does. */
  function detectDelimiter(text) {
    var sample = text.length > 65536 ? text.slice(0, 65536) : text;
    var truncated = sample.length < text.length;
    var hint = /^sep=([,;\t])[ ]*(?:\r|\n|$)/i.exec(sample.charCodeAt(0) === 0xFEFF ? sample.slice(1) : sample);
    if (hint) { return hint[1]; }
    var candidates = [';', '\t', ','], best = ',', bestScore = 0;
    candidates.forEach(function (d) {
      var recs = parseCsv(sample, d).records.filter(function (r) { return !isEmptyRecord(r); });
      if (truncated && recs.length > 1) { recs.pop(); }
      recs = recs.slice(0, 50);
      var freq = {}, mode = 0, modeCount = 0;
      recs.forEach(function (r) {
        var k = r.cells.length;
        freq[k] = (freq[k] || 0) + 1;
        if (k > 1 && (freq[k] > modeCount || (freq[k] === modeCount && k > mode))) {
          mode = k; modeCount = freq[k];
        }
      });
      var score = mode > 1 ? modeCount * (mode - 1) : 0;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  /* ---------- dates ---------- */

  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };
  var RE_YMD = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/;
  var RE_COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
  var RE_NUM = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4}|\d{2})(?:[T\s,].*)?$/;
  var RE_MONTH_FIRST = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[\s,].*)?$/;
  var RE_DAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]+([A-Za-z]{3,9})\.?,?[\s\-\/.]+(\d{4}|\d{2})(?:[\s,].*)?$/;

  function fullYear(y) {
    y = parseInt(y, 10);
    if (y < 100) { return y < 70 ? 2000 + y : 1900 + y; }
    return y;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function isoDate(y, m, d) {
    if (!(y >= 1900 && y <= 2100) || !(m >= 1 && m <= 12) || d < 1) { return null; }
    var dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    return d <= dim ? y + '-' + pad2(m) + '-' + pad2(d) : null;
  }

  /* Returns 'YYYY-MM-DD' or null. order: 'MDY' or 'DMY', used only for all-numeric
     dates such as 03/04/2024; with any other order value those dates return null. */
  function parseDate(raw, order) {
    var s = String(raw == null ? '' : raw).trim(), m, mon;
    if (s === '') { return null; }
    if ((m = RE_YMD.exec(s))) { return isoDate(+m[1], +m[2], +m[3]); }
    if ((m = RE_COMPACT.exec(s))) { return isoDate(+m[1], +m[2], +m[3]); }
    if ((m = RE_NUM.exec(s))) {
      if (order === 'DMY') { return isoDate(fullYear(m[3]), +m[2], +m[1]); }
      if (order === 'MDY') { return isoDate(fullYear(m[3]), +m[1], +m[2]); }
      return null;
    }
    if ((m = RE_MONTH_FIRST.exec(s))) {
      mon = MONTHS[m[1].toLowerCase()];
      return mon ? isoDate(+m[3], mon, +m[2]) : null;
    }
    if ((m = RE_DAY_FIRST.exec(s))) {
      mon = MONTHS[m[2].toLowerCase()];
      return mon ? isoDate(fullYear(m[3]), mon, +m[1]) : null;
    }
    return null;
  }

  /* Counts all-numeric dates and those that can only be day-first or only month-first.
     A value counts as proof only when it is a possible date in that order: one part is
     13 to 31 and the other is 1 to 12. Impossible values such as 45/01/2024 prove nothing. */
  function analyzeDateOrder(values) {
    var dmy = 0, mdy = 0, numeric = 0, samples = [];
    values.forEach(function (v) {
      var m = RE_NUM.exec(v), a, b;
      if (!m) { return; }
      numeric++;
      if (samples.length < 3 && samples.indexOf(v) < 0) { samples.push(v); }
      a = +m[1]; b = +m[2];
      if (a > 12 && a <= 31 && b >= 1 && b <= 12) { dmy++; }
      else if (b > 12 && b <= 31 && a >= 1 && a <= 12) { mdy++; }
    });
    return { dmy: dmy, mdy: mdy, numeric: numeric, samples: samples };
  }

  /* ---------- amounts ---------- */

  /* Non-ASCII characters are written as code point escapes inside string literals, so this
     file stays pure ASCII. The regular expressions are built from those strings. */

  /* Dollar, euro, pound, yen, rupee, rouble, won, shekel, lira, hryvnia, naira, baht, cent. */
  var RE_SYMBOL = new RegExp('[$\u{20AC}\u{A3}\u{A5}\u{20B9}\u{20BD}\u{20A9}\u{20AA}' +
    '\u{20BA}\u{20B4}\u{20A6}\u{E3F}\u{A2}]', 'g');
  /* Typographic hyphens and dashes (U+2010 to U+2015) and the mathematical minus sign (U+2212). */
  var RE_DASHES = new RegExp('[\u{2010}-\u{2015}\u{2212}]', 'g');
  /* Thousands spacers: any white space (this covers the no-break spaces) and apostrophes. */
  var RE_SPACERS = new RegExp("[\\s'\u{2019}]", 'g');
  /* Combining accents left behind by NFD normalisation (U+0300 to U+036F). */
  var RE_COMBINING = new RegExp('[\u{300}-\u{36F}]', 'g');
  /* Symbols that name exactly one currency. "$" and the yen/yuan sign are left blank on purpose. */
  var SYMBOL_CODES = {
    '\u{20AC}': 'EUR', '\u{A3}': 'GBP', '\u{20B9}': 'INR', '\u{20BD}': 'RUB', '\u{20A9}': 'KRW',
    '\u{20AA}': 'ILS', '\u{20BA}': 'TRY', '\u{20B4}': 'UAH', '\u{20A6}': 'NGN', '\u{E3F}': 'THB'
  };
  var DOLLAR_PREFIXES = {
    US: 'USD', CA: 'CAD', C: 'CAD', A: 'AUD', AU: 'AUD', NZ: 'NZD', HK: 'HKD', S: 'SGD',
    SG: 'SGD', MX: 'MXN', R: 'BRL'
  };
  var RE_PARENS = /^\(.*\)$/;

  function countChar(s, ch) {
    var n = 0, i;
    for (i = 0; i < s.length; i++) { if (s[i] === ch) { n++; } }
    return n;
  }

  /* style: 'dot' or 'comma' = the decimal separator of the file. It only matters for a
     value with a single separator followed by exactly three digits (1,234 or 1.234).
     Returns { ok: true, value: '-1234.56', currency: 'EUR' or '' } or { ok: false, empty: bool }.
     Negative forms accepted: -1.00, 1.00-, (1.00), ($1.00), $(1.00), 1.00 DR, DR 1.00. */
  function parseAmount(raw, style) {
    var s = String(raw == null ? '' : raw).trim().replace(RE_DASHES, '-');
    var neg = false, m, code, currency = '', symbols, bare;
    var fail = { ok: false, empty: false };
    if (s === '' || /^-+$/.test(s)) { return { ok: false, empty: true }; }
    symbols = s.match(RE_SYMBOL);
    if (symbols && SYMBOL_CODES[symbols[0]]) { currency = SYMBOL_CODES[symbols[0]]; }
    if (RE_PARENS.test(s)) {
      neg = true; s = s.slice(1, -1).trim();
    } else {
      bare = s.replace(RE_SYMBOL, '').trim();
      if (RE_PARENS.test(bare)) { neg = true; s = bare.slice(1, -1).trim(); }
    }
    if ((m = /^([-+]?)\s*([A-Za-z]{1,3})\s*(\$?)\s*([-+\d.,].*)$/.exec(s))) {
      code = m[2].toUpperCase();
      if (m[3]) {
        if (!DOLLAR_PREFIXES[code]) { return fail; }
        currency = DOLLAR_PREFIXES[code];
      } else if (code.length === 3) {
        currency = code;
      } else if (code === 'DR' || code === 'DB') {
        neg = true;
      } else if (code !== 'CR') {
        return fail;
      }
      s = m[1] + m[4];
    }
    s = s.replace(RE_SYMBOL, '').trim();
    if ((m = /^(.*[\d\-+])\s*([A-Za-z]{2,3})$/.exec(s))) {
      code = m[2].toUpperCase();
      if (code === 'DR' || code === 'DB') { neg = true; }
      else if (code.length === 3) { currency = code; }
      else if (code !== 'CR') { return fail; }
      s = m[1];
    }
    s = s.replace(RE_SPACERS, '');
    m = /^([+-]?)(\d[\d.,]*|[.,]\d+)([+-]?)$/.exec(s);
    if (!m || (m[1] && m[3])) { return fail; }
    if (m[1] === '-' || m[3] === '-') { neg = true; }
    var body = m[2];
    var nDot = countChar(body, '.'), nCom = countChar(body, ',');
    var dec = '';
    if (nDot && nCom) {
      dec = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    } else if (nDot + nCom === 1) {
      var ch = nDot ? '.' : ',';
      var before = body.indexOf(ch), after = body.length - 1 - before;
      /* 0.500 or 0,500 is never a thousands group: a group cannot start with a zero. */
      var grouped = after === 3 && before >= 1 && before <= 3 && body[0] !== '0';
      var native = style === 'comma' ? ',' : '.';
      dec = (ch === native || !grouped) ? ch : '';
    }
    if (dec && countChar(body, dec) !== 1) { return fail; }
    var cut = dec ? body.lastIndexOf(dec) : body.length;
    var intRaw = body.slice(0, cut), frac = dec ? body.slice(cut + 1) : '';
    if (/[.,]/.test(intRaw) && !/^\d{1,3}([.,]\d{2,3})*[.,]\d{3}$/.test(intRaw)) { return fail; }
    var intPart = intRaw.replace(/[.,]/g, '');
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart === '' && frac === '')) { return fail; }
    intPart = intPart.replace(/^0+(?=\d)/, '') || '0';
    while (frac.length < 2) { frac += '0'; }
    var value = intPart + '.' + frac;
    if (neg && /[1-9]/.test(value)) { value = '-' + value; }
    return { ok: true, value: value, currency: currency };
  }

  /* Returns { style: 'dot' | 'comma', ambiguous: bool }. `ambiguous` is true when the only
     separators seen are single ones followed by exactly three digits (1,234 / 1.234). */
  function detectDecimalStyle(values) {
    var comma = 0, dot = 0, unclear = 0;
    values.forEach(function (v) {
      var m = /\d[\d.,]*\d|\d/.exec(v);
      if (!m) { return; }
      var b = m[0], nDot = countChar(b, '.'), nCom = countChar(b, ',');
      if (nDot && nCom) {
        if (b.lastIndexOf(',') > b.lastIndexOf('.')) { comma++; } else { dot++; }
      } else if (nDot + nCom === 1) {
        var after = b.length - 1 - b.search(/[.,]/);
        if (after !== 3 || b[0] === '0') { if (nCom) { comma++; } else { dot++; } }
        else { unclear++; }
      }
    });
    return { style: comma > dot ? 'comma' : 'dot', ambiguous: comma === 0 && dot === 0 && unclear > 0 };
  }

  function isZero(v) { return !/[1-9]/.test(v); }
  function forceNegative(v) { return isZero(v) ? v.replace('-', '') : (v[0] === '-' ? v : '-' + v); }
  function forcePositive(v) { return v[0] === '-' ? v.slice(1) : v; }

  /* Exact decimal addition on normalised strings (no floating point). */
  function addDecimal(a, b) {
    var fa = a.split('.')[1].length, fb = b.split('.')[1].length, f = Math.max(fa, fb);
    function scaled(s, fl) {
      var v = BigInt(s.replace('-', '').replace('.', '') + '0'.repeat(f - fl));
      return s[0] === '-' ? -v : v;
    }
    var sum = scaled(a, fa) + scaled(b, fb), neg = sum < BigInt(0);
    var digits = (neg ? -sum : sum).toString();
    while (digits.length < f + 1) { digits = '0' + digits; }
    var out = digits.slice(0, digits.length - f) + '.' + digits.slice(digits.length - f);
    return neg ? '-' + out : out;
  }

  /* ---------- header and profile detection ---------- */

  function normHeader(s) {
    s = String(s == null ? '' : s).toLowerCase();
    if (s.normalize) { s = s.normalize('NFD').replace(RE_COMBINING, ''); }
    return s.replace(/[^a-z0-9]+/g, ' ').trim();
  }

  var EXACT = {
    date: ['date', 'transaction date', 'posting date', 'posted date', 'post date', 'trans date',
      'booking date', 'date posted', 'effective date', 'value date', 'fecha', 'fecha operacion',
      'fecha valor', 'buchungstag', 'buchungsdatum', 'datum', 'valuta', 'date operation',
      'date de l operation'],
    description: ['description', 'transaction description', 'details', 'transaction details', 'memo',
      'narrative', 'payee', 'name', 'particulars', 'merchant', 'text', 'concepto', 'descripcion',
      'detalle', 'verwendungszweck', 'buchungstext', 'libelle'],
    amount: ['amount', 'transaction amount', 'amt', 'value', 'importe', 'monto', 'betrag', 'montant'],
    debit: ['debit', 'debit amount', 'debits', 'withdrawal', 'withdrawals', 'withdrawal amount',
      'money out', 'paid out', 'cargo', 'debe', 'debito', 'soll'],
    credit: ['credit', 'credit amount', 'credits', 'deposit', 'deposits', 'deposit amount',
      'money in', 'paid in', 'abono', 'haber', 'credito', 'haben'],
    reference: ['reference', 'reference number', 'ref', 'ref number', 'transaction id',
      'transaction reference', 'check number', 'cheque number', 'check no', 'check or slip',
      'check', 'id', 'referencia', 'num'],
    indicator: ['dr cr', 'cr dr', 'debit credit', 'credit debit', 'credit debit indicator',
      'debit credit indicator', 'transaction type', 'type', 'details'],
    currency: ['currency', 'currency code', 'ccy', 'moneda', 'divisa', 'wahrung', 'waehrung', 'devise']
  };
  var CONTAINS = {
    date: ['date', 'fecha', 'datum'],
    description: ['description', 'memo', 'details', 'narrative', 'payee', 'concepto', 'descripcion'],
    amount: ['amount', 'importe', 'betrag', 'montant'],
    debit: ['debit', 'withdrawal', 'paid out', 'money out'],
    credit: ['credit', 'deposit', 'paid in', 'money in'],
    reference: ['reference', 'transaction id', 'check n', 'cheque n'],
    indicator: [],
    currency: []
  };

  /* A header that holds one of these whole words names an id column (Deposit ID, Reference
     number). Such a column is never taken as the amount, the debit or the credit column. */
  var RE_ID_HEADER = /(^| )(id|ids|reference|ref|number)( |$)/;
  var MONEY_ROLES = { amount: true, debit: true, credit: true };

  function findColumn(H, role, used) {
    var i, j, list = EXACT[role];
    for (i = 0; i < list.length; i++) {
      for (j = 0; j < H.length; j++) {
        if (!used[j] && H[j] === list[i]) { return j; }
      }
    }
    list = CONTAINS[role];
    for (i = 0; i < list.length; i++) {
      for (j = 0; j < H.length; j++) {
        if (used[j] || H[j].indexOf(list[i]) < 0) { continue; }
        if (/balance|saldo/.test(H[j])) { continue; }
        if (MONEY_ROLES[role] === true && RE_ID_HEADER.test(H[j])) { continue; }
        if ((role === 'debit' || role === 'credit') && /debit/.test(H[j]) && /credit/.test(H[j])) { continue; }
        return j;
      }
    }
    return -1;
  }

  function blankMap(profile) {
    return {
      profile: profile, date: -1, desc: [], descPrefix: '', descSep: ' - ', amount: -1,
      amountMayBeEmpty: false, debit: -1, credit: -1, indicator: -1, fee: -1, feeIsCost: false,
      feeInNet: true, net: -1, ref: -1, currency: -1, inferred: false, headerless: false
    };
  }

  /* Fee and net headers of a generic export, as normHeader writes them. Whole-name matches only. */
  var BANK_FEE = ['fee', 'fees', 'total fees', 'processing fee'];
  var BANK_NET = ['net', 'net amount', 'net total'];

  /* Last-resort date and amount headers of a generic export: tried only when no name of the
     EXACT and CONTAINS lists gave that column, so a file read by those lists is read as before.
     The amount names are the gross-type headers (the figure before fees). They are also tried
     when the amount column found by name is the net column of the file: see mapBank. */
  var BANK_DATE_LAST = ['created', 'created utc'];
  var BANK_AMOUNT_LAST = ['gross', 'gross amount', 'gross transaction amount', 'total collected'];

  function findExact(H, names, used) {
    var i, j;
    for (i = 0; i < names.length; i++) {
      for (j = 0; j < H.length; j++) {
        if (!used[j] && H[j] === names[i]) { return j; }
      }
    }
    return -1;
  }

  function present(list) { return list.filter(function (x) { return x >= 0; }); }

  function mapPaypal(H) {
    var map = blankMap('paypal');
    map.date = H.indexOf('date');
    map.amount = H.indexOf('gross');
    map.net = H.indexOf('net');
    map.ref = H.indexOf('transaction id');
    if (map.date < 0 || map.amount < 0 || (map.net < 0 && map.ref < 0)) { return null; }
    map.fee = H.indexOf('fee');
    map.desc = present([H.indexOf('name'), H.indexOf('type')]);
    map.currency = H.indexOf('currency');
    return map;
  }

  function mapEtsyOrders(H) {
    var map = blankMap('etsy_orders');
    map.date = H.indexOf('sale date');
    map.ref = H.indexOf('order id');
    map.amount = H.indexOf('order total');
    if (map.amount < 0) { map.amount = H.indexOf('order value'); }
    if (map.date < 0 || map.ref < 0 || map.amount < 0) { return null; }
    map.fee = H.indexOf('card processing fees');
    map.feeIsCost = true;
    map.net = H.indexOf('order net');
    var name = H.indexOf('full name');
    if (name < 0) { name = H.indexOf('buyer'); }
    map.desc = present([name]);
    map.descPrefix = 'Etsy order';
    map.currency = H.indexOf('currency');
    return map;
  }

  function mapEtsyStatement(H) {
    var map = blankMap('etsy_statement');
    map.date = H.indexOf('date');
    map.amount = H.indexOf('amount');
    map.fee = H.indexOf('fees taxes');
    map.net = H.indexOf('net');
    var title = H.indexOf('title');
    if (map.date < 0 || map.amount < 0 || map.fee < 0 || map.net < 0 || title < 0) { return null; }
    map.amountMayBeEmpty = true;
    map.desc = present([H.indexOf('type'), title]);
    map.descSep = ': ';
    map.ref = H.indexOf('info');
    map.currency = H.indexOf('currency');
    return map;
  }

  function mapBank(H) {
    var used = {}, map = blankMap('bank');
    function take(role) {
      var j = findColumn(H, role, used);
      if (j >= 0) { used[j] = true; }
      return j;
    }
    map.date = take('date');
    if (map.date < 0) {
      map.date = findExact(H, BANK_DATE_LAST, used);
      if (map.date >= 0) { used[map.date] = true; }
    }
    if (map.date < 0) { return null; }
    var debit = take('debit'), credit = take('credit'), amount = take('amount');
    /* A gross-type column is the amount when no amount column was found by name, and also
       when the one found is the net column of the file (Net amount next to Gross transaction
       amount). The net column is then set free, and the net role below takes it. With no
       gross-type column the choice made above stays as it is. */
    var netAsAmount = amount >= 0 && BANK_NET.indexOf(H[amount]) >= 0;
    if (amount < 0 || netAsAmount) {
      var gross = findExact(H, BANK_AMOUNT_LAST, used);
      if (gross >= 0) {
        if (netAsAmount) { delete used[amount]; }
        amount = gross;
        used[amount] = true;
      }
    }
    if ((debit >= 0 && credit >= 0) || (amount < 0 && (debit >= 0 || credit >= 0))) {
      map.debit = debit; map.credit = credit;
      if (amount >= 0) { delete used[amount]; }
    } else {
      if (amount < 0) { return null; }
      map.amount = amount;
      if (debit >= 0) { delete used[debit]; }
      if (credit >= 0) { delete used[credit]; }
    }
    map.desc = present([take('description')]);
    map.ref = take('reference');
    map.currency = take('currency');
    if (map.amount >= 0) { map.indicator = findColumn(H, 'indicator', used); }
    /* Fee and net come last, from the columns no other role took, so the columns above are
       chosen exactly as they are without them. The sign convention of a generic fee column
       is not known, so the fee is written as the file has it and is never added to the
       amount: net is the net column when there is one, else the amount. */
    map.fee = findExact(H, BANK_FEE, used);
    if (map.fee >= 0) { used[map.fee] = true; }
    map.net = findExact(H, BANK_NET, used);
    map.feeInNet = false;
    return map;
  }

  var MAPPERS = { paypal: mapPaypal, etsy_orders: mapEtsyOrders, etsy_statement: mapEtsyStatement, bank: mapBank };

  function mapByNames(H, profile) {
    if (MAPPERS[profile]) { return MAPPERS[profile](H); }
    return mapPaypal(H) || mapEtsyOrders(H) || mapEtsyStatement(H) || mapBank(H);
  }

  function anyDate(v) { return parseDate(v, 'MDY') || parseDate(v, 'DMY'); }

  /* Fallback when no header row is recognised by name: guess columns from the data itself. */
  function inferMap(recs, first) {
    var headerless = recs[first].cells.some(function (c) { return !!anyDate(c); });
    var start = headerless ? first : first + 1, width = 0, i, j, rows = [];
    for (i = start; i < recs.length && rows.length < 200; i++) {
      if (!isEmptyRecord(recs[i])) {
        rows.push(recs[i].cells);
        width = Math.max(width, recs[i].cells.length);
      }
    }
    if (!rows.length) { return null; }
    var H = headerless ? [] : recs[first].cells.map(normHeader);
    var stats = [];
    for (j = 0; j < width; j++) {
      var filled = 0, dates = 0, nums = 0, decimals = 0, len = 0;
      for (i = 0; i < rows.length; i++) {
        var v = rows[i][j] || '';
        if (v === '') { continue; }
        filled++; len += v.length;
        if (anyDate(v)) { dates++; }
        else if (parseAmount(v, 'dot').ok) { nums++; if (/[.,]\d{1,2}\D*$/.test(v)) { decimals++; } }
      }
      stats.push({
        col: j, filled: filled,
        dateFrac: filled ? dates / filled : 0,
        numFrac: filled ? nums / filled : 0,
        decFrac: filled ? decimals / filled : 0,
        avgLen: filled ? len / filled : 0
      });
    }
    var dateCol = -1, bestFrac = 0.6;
    stats.forEach(function (s) {
      if (s.filled && s.dateFrac >= bestFrac && (dateCol < 0 || s.dateFrac > bestFrac)) {
        dateCol = s.col; bestFrac = s.dateFrac;
      }
    });
    if (dateCol < 0) { return null; }
    var numeric = stats.filter(function (s) {
      return s.col !== dateCol && s.filled && s.numFrac >= 0.8 && !/balance|saldo/.test(H[s.col] || '') &&
        !RE_ID_HEADER.test(H[s.col] || '');
    });
    if (!numeric.length) { return null; }
    var withDecimals = numeric.filter(function (s) { return s.decFrac >= 0.5; });
    if (withDecimals.length) { numeric = withDecimals; }
    var map = blankMap('bank');
    map.inferred = true; map.headerless = headerless; map.date = dateCol;
    map.amount = numeric[0].col;
    var descCol = -1, bestLen = 0;
    stats.forEach(function (s) {
      if (s.col === dateCol || s.numFrac >= 0.8 || s.dateFrac >= 0.6) { return; }
      if (s.avgLen > bestLen) { bestLen = s.avgLen; descCol = s.col; }
    });
    map.desc = descCol >= 0 ? [descCol] : [];
    return map;
  }

  /* ---------- main entry ---------- */

  /* options: { profile: 'auto' | 'paypal' | 'etsy_orders' | 'etsy_statement' | 'bank',
                delimiter: 'auto' | ',' | ';' | '\t', dateOrder: 'auto' | 'DMY' | 'MDY',
                decimal: 'auto' | 'dot' | 'comma', keepDuplicates: bool } */
  function clean(text, options) {
    var o = options || {};
    var profileOpt = MAPPERS[o.profile] ? o.profile : 'auto';
    var res = {
      ok: false, error: '', needsDateOrder: false, dateSamples: [], warnings: [], rows: [],
      unparsed: [], preamble: [], footer: [], duplicates: [],
      delimiter: ',', profile: '', profileLabel: '', headerLine: 0, mapping: {},
      dateOrder: '', dateOrderSource: '', decimalStyle: '', inferred: false,
      counts: {
        records: 0, header: 0, blank: 0, preamble: 0, repeatedHeaders: 0, rowsIn: 0, rowsOut: 0,
        duplicatesDropped: 0, duplicatesKept: 0, footer: 0, unparsed: 0
      }
    };
    text = String(text == null ? '' : text);
    var delim = (o.delimiter === ',' || o.delimiter === ';' || o.delimiter === '\t')
      ? o.delimiter : detectDelimiter(text);
    res.delimiter = delim;
    var parsed = parseCsv(text, delim), recs = parsed.records, i;
    if (parsed.unterminatedQuote) {
      res.warnings.push('A quoted field was still open at the end of the file; the last record may be incomplete.');
    }
    recs.forEach(function (r) { r.cells = r.cells.map(function (c) { return c.trim(); }); });
    res.counts.records = recs.length;

    var first = -1;
    for (i = 0; i < recs.length; i++) { if (!isEmptyRecord(recs[i])) { first = i; break; } }
    if (first < 0) { res.error = 'The file has no data rows.'; return res; }

    /* Locate the header row and the column mapping. */
    var hdr = -1, map = null, limit = Math.min(recs.length, 50);
    for (i = first; i < limit; i++) {
      if (isEmptyRecord(recs[i])) { continue; }
      map = mapByNames(recs[i].cells.map(normHeader), profileOpt);
      if (map) { hdr = i; break; }
    }
    if (!map) {
      var found = recs[first].cells.filter(function (c) { return c !== ''; }).join(', ');
      if (profileOpt !== 'auto' && profileOpt !== 'bank') {
        res.error = 'The file does not have the columns expected for "' + PROFILE_LABELS[profileOpt] +
          '". First row found: ' + found + '. Try automatic detection or the generic bank format.';
        return res;
      }
      map = inferMap(recs, first);
      if (!map) {
        res.error = 'Could not find a date column and an amount column. First row found: ' + found +
          '. Check the delimiter setting, or pick the input format by hand.';
        return res;
      }
      hdr = first;
      res.warnings.push('No recognised header row was found, so the columns were guessed from the data. Check the column mapping below.');
    }
    var headerless = map.headerless;
    var headerCells = headerless ? [] : recs[hdr].cells;
    function colName(j) {
      if (j < 0) { return ''; }
      return headerless ? 'column ' + (j + 1) : (headerCells[j] || 'column ' + (j + 1));
    }
    var split = map.debit >= 0 || map.credit >= 0;
    res.profile = map.profile;
    res.profileLabel = PROFILE_LABELS[map.profile];
    res.inferred = map.inferred;
    res.headerLine = headerless ? 0 : recs[hdr].line;
    res.counts.header = headerless ? 0 : 1;
    res.mapping = {
      date: colName(map.date),
      description: (map.descPrefix ? ['"' + map.descPrefix + '"'] : []).concat(map.desc.map(colName)).join(' + ') || '(none)',
      amount: split
        ? [map.credit >= 0 ? colName(map.credit) : '', map.debit >= 0 ? 'minus ' + colName(map.debit) : '']
          .filter(Boolean).join(' ')
        : colName(map.amount),
      currency: map.currency >= 0 ? colName(map.currency) : 'currency code or symbol in the amount, if any',
      fee: map.fee >= 0 ? colName(map.fee) + (map.feeIsCost ? ' (written as a negative number)' : '') : '(left empty)',
      net: map.net >= 0 ? colName(map.net) : (map.fee >= 0 && map.feeInNet ? 'amount + fee' : 'same as amount'),
      reference: map.ref >= 0 ? colName(map.ref) : '(none)'
    };

    function rawOf(rec) {
      var s = rec.cells.join(' | ').replace(/\s+/g, ' ');
      return s.length > 200 ? s.slice(0, 200) + '...' : s;
    }

    /* Lines before the header are listed, never silently dropped. */
    for (i = 0; i < hdr; i++) {
      if (isEmptyRecord(recs[i])) { res.counts.blank++; continue; }
      res.preamble.push({ line: recs[i].line, raw: rawOf(recs[i]) });
    }
    res.counts.preamble = res.preamble.length;

    var headerKey = headerless ? null : headerCells.map(normHeader).join('\u0001');
    var data = [];
    for (i = headerless ? hdr : hdr + 1; i < recs.length; i++) {
      if (isEmptyRecord(recs[i])) { res.counts.blank++; continue; }
      if (headerKey !== null && recs[i].cells.map(normHeader).join('\u0001') === headerKey) {
        res.counts.repeatedHeaders++; continue;
      }
      data.push(recs[i]);
    }
    res.counts.rowsIn = data.length;

    function cell(rec, j) { return j >= 0 && j < rec.cells.length ? rec.cells[j] : ''; }

    /* Decimal separator convention of the file. */
    var decimal = o.decimal === 'dot' || o.decimal === 'comma' ? o.decimal : '';
    if (!decimal) {
      var amountCols = present([map.amount, map.debit, map.credit, map.fee, map.net]), amountValues = [];
      data.forEach(function (r) { amountCols.forEach(function (j) { amountValues.push(cell(r, j)); }); });
      var seenDecimal = detectDecimalStyle(amountValues);
      decimal = seenDecimal.style;
      if (seenDecimal.ambiguous) {
        res.warnings.push('Some amounts have one separator followed by three digits (such as 1,234 or 1.234) and no other amount shows which separator is the decimal one. They were read with a dot as the decimal separator. Set "Decimal separator" by hand if that is wrong.');
      }
    }
    res.decimalStyle = decimal;

    /* Day/month order of all-numeric dates: taken from the file only when the file proves it. */
    var order = o.dateOrder === 'DMY' || o.dateOrder === 'MDY' ? o.dateOrder : '';
    var seen = analyzeDateOrder(data.map(function (r) { return cell(r, map.date); }));
    if (order) {
      res.dateOrderSource = 'chosen';
    } else if (seen.numeric === 0) {
      res.dateOrderSource = 'not needed';
    } else if (seen.dmy > 0 && seen.mdy === 0) {
      order = 'DMY'; res.dateOrderSource = 'detected';
    } else if (seen.mdy > 0 && seen.dmy === 0) {
      order = 'MDY'; res.dateOrderSource = 'detected';
    } else {
      res.needsDateOrder = true;
      res.dateSamples = seen.samples;
      res.error = seen.dmy > 0
        ? 'This file mixes dates that can only be day-first with dates that can only be month-first. Choose the date order to use; rows that do not fit it will be listed as not parsed.'
        : 'The dates in this file (for example ' + seen.samples.join(', ') + ') do not show whether the day or the month comes first: no day is above 12. Choose the date order to continue. Nothing is guessed.';
      return res;
    }
    if (order && seen.dmy > 0 && seen.mdy > 0) {
      res.warnings.push('The file mixes day-first and month-first dates. Rows that do not fit the chosen order are listed as not parsed.');
    }
    res.dateOrder = order;

    /* A debit/credit indicator column is honoured only if every value is a known marker. */
    var DEBIT_MARKS = { debit: 1, dr: 1, d: 1, db: 1 }, CREDIT_MARKS = { credit: 1, cr: 1, c: 1 };
    var useIndicator = false;
    if (map.indicator >= 0) {
      var marks = 0;
      useIndicator = data.every(function (r) {
        var v = cell(r, map.indicator).toLowerCase();
        if (v === '') { return true; }
        marks++;
        return DEBIT_MARKS[v] === 1 || CREDIT_MARKS[v] === 1;
      }) && marks > 0;
    }

    /* Returns { amount, fee, net, currency } or { error }. */
    function moneyOf(rec) {
      var amount, fee = '', net, currency = '', a, f, n, raw;
      if (split) {
        var db = parseAmount(cell(rec, map.debit), decimal), cr = parseAmount(cell(rec, map.credit), decimal);
        if (!db.ok && !db.empty) { return { error: 'debit is not a number: "' + cell(rec, map.debit) + '"' }; }
        if (!cr.ok && !cr.empty) { return { error: 'credit is not a number: "' + cell(rec, map.credit) + '"' }; }
        if (!db.ok && !cr.ok) { return { error: 'debit and credit are both empty' }; }
        amount = cr.ok ? cr.value : '0.00';
        if (db.ok) { amount = addDecimal(amount, forceNegative(db.value)); }
        currency = (cr.ok && cr.currency) || (db.ok && db.currency) || '';
      } else {
        raw = cell(rec, map.amount);
        a = parseAmount(raw, decimal);
        if (!a.ok && !a.empty) { return { error: 'amount is not a number: "' + raw + '"' }; }
        if (a.ok) {
          amount = a.value; currency = a.currency;
          if (useIndicator) {
            var mark = cell(rec, map.indicator).toLowerCase();
            if (DEBIT_MARKS[mark] === 1) { amount = forceNegative(amount); }
            else if (CREDIT_MARKS[mark] === 1) { amount = forcePositive(amount); }
          }
        }
      }
      if (map.fee >= 0) {
        raw = cell(rec, map.fee);
        f = parseAmount(raw, decimal);
        if (!f.ok && !f.empty) { return { error: 'fee is not a number: "' + raw + '"' }; }
        if (f.ok) {
          fee = map.feeIsCost ? forceNegative(f.value) : f.value;
          currency = currency || f.currency;
        }
      }
      if (map.net >= 0) {
        raw = cell(rec, map.net);
        n = parseAmount(raw, decimal);
        if (!n.ok && !n.empty) { return { error: 'net is not a number: "' + raw + '"' }; }
        if (n.ok) { net = n.value; currency = currency || n.currency; }
      }
      if (amount === undefined) {
        if (!map.amountMayBeEmpty) { return { error: 'amount is empty' }; }
        if (fee === '' && net === undefined) {
          return { error: 'amount, fee and net are all empty (the figure may appear only in the description text)' };
        }
        amount = '0.00';
      }
      if (map.fee >= 0 && fee === '') { fee = '0.00'; }
      if (net === undefined) { net = fee === '' || !map.feeInNet ? amount : addDecimal(amount, fee); }
      return { amount: amount, fee: fee, net: net, currency: currency };
    }

    var firstSeen = {}, keepDuplicates = !!o.keepDuplicates, lastGood = -1, failed = [];
    data.forEach(function (rec, index) {
      var rawDate = cell(rec, map.date), d = parseDate(rawDate, order);
      if (!d) {
        failed.push({
          index: index, dateProblem: true, line: rec.line, raw: rawOf(rec),
          reason: rawDate === '' ? 'date is empty' : 'date not recognised: "' + rawDate + '"'
        });
        return;
      }
      var money = moneyOf(rec);
      if (money.error) {
        failed.push({ index: index, dateProblem: false, line: rec.line, raw: rawOf(rec), reason: money.error });
        return;
      }
      lastGood = index;
      var key = rec.cells.join('\u0001'), duplicateOf = 0;
      if (Object.prototype.hasOwnProperty.call(firstSeen, key)) {
        duplicateOf = firstSeen[key];
        res.duplicates.push({ line: rec.line, firstLine: duplicateOf, raw: rawOf(rec) });
        if (!keepDuplicates) { return; }
      } else {
        firstSeen[key] = rec.line;
      }
      var parts = map.descPrefix ? [map.descPrefix] : [];
      map.desc.forEach(function (j) { var v = cell(rec, j); if (v !== '') { parts.push(v); } });
      res.rows.push({
        line: rec.line,
        date: d,
        description: parts.join(map.descSep).replace(/\s+/g, ' ').trim(),
        amount: money.amount,
        currency: (cell(rec, map.currency) || money.currency).toUpperCase(),
        fee: money.fee,
        net: money.net,
        reference: cell(rec, map.ref).replace(/\s+/g, ' '),
        source: map.profile,
        duplicateOf: duplicateOf
      });
    });

    /* Lines after the last transaction that carry no date are footer junk (totals, notes). */
    failed.forEach(function (x) {
      var item = { line: x.line, raw: x.raw, reason: x.reason };
      if (x.dateProblem && x.index > lastGood && lastGood >= 0) { res.footer.push(item); }
      else { res.unparsed.push(item); }
    });

    var currencies = {};
    res.rows.forEach(function (r) { if (r.currency) { currencies[r.currency] = true; } });
    var list = Object.keys(currencies);
    if (list.length > 1) {
      res.warnings.push('The file contains more than one currency (' + list.slice(0, 8).join(', ') +
        '). Amounts are not converted; filter by the currency column before importing.');
    }

    res.counts.footer = res.footer.length;
    res.counts.unparsed = res.unparsed.length;
    res.counts.duplicatesDropped = keepDuplicates ? 0 : res.duplicates.length;
    res.counts.duplicatesKept = keepDuplicates ? res.duplicates.length : 0;
    res.counts.rowsOut = res.rows.length;
    res.ok = true;
    return res;
  }

  /* ---------- output ---------- */

  /* cap: maximum number of rows to return; 0 means no cap. */
  function limitRows(rows, cap) {
    return cap > 0 ? rows.slice(0, cap) : rows;
  }

  function csvField(v) {
    v = String(v);
    return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function buildCsv(rows) {
    var lines = [COLUMNS.join(',')];
    rows.forEach(function (r) {
      lines.push(COLUMNS.map(function (name) { return csvField(r[name]); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  return {
    COLUMNS: COLUMNS,
    PROFILE_LABELS: PROFILE_LABELS,
    DELIMITER_LABELS: DELIMITER_LABELS,
    decodeBytes: decodeBytes,
    parseCsv: parseCsv,
    detectDelimiter: detectDelimiter,
    parseDate: parseDate,
    parseAmount: parseAmount,
    detectDecimalStyle: detectDecimalStyle,
    addDecimal: addDecimal,
    clean: clean,
    limitRows: limitRows,
    buildCsv: buildCsv
  };
});
