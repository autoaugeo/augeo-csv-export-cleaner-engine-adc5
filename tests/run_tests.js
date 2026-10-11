/* Tests for the CSV Cleaner engine (../cleaner.js).
   Plain node: assert, fs and path only. No packages, no network, no file writes.
   Run from anywhere: node tests/run_tests.js
   Prints one ok/FAIL line per check and a final "N passed, M failed";
   exits 1 on any failure. The sample files in ../fixtures/ are synthetic. */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var C = require('../cleaner.js');

var FIXTURES = [
  'bank-multiline-parentheses.csv',
  'bank-preamble-debit-credit.csv',
  'bank-semicolon-decimal-comma-dmy.csv',
  'etsy-monthly-statement.csv',
  'etsy-sold-orders.csv',
  'paypal-activity.csv'
];
var HEADER = 'date,description,amount,currency,fee,net,reference,source';
var RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
var RE_AMOUNT = /^-?\d+(\.\d+)?$/;
var PREVIEW_ROWS = 20;

var passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   - ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL - ' + name + ' :: ' + String(e && e.message ? e.message : e).replace(/\s+/g, ' '));
  }
}

function readFixture(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', file), 'utf8');
}

test('engine exports the core functions and the fixed column list', function () {
  ['parseCsv', 'detectDelimiter', 'parseDate', 'parseAmount', 'detectDecimalStyle', 'addDecimal',
    'clean', 'limitRows', 'buildCsv'].forEach(function (name) {
    assert.strictEqual(typeof C[name], 'function', name + ' is not exported');
  });
  assert.deepStrictEqual(C.COLUMNS, HEADER.split(','));
});

test('fixtures: the fixtures folder holds exactly the six files listed in this runner', function () {
  var found = fs.readdirSync(path.join(__dirname, '..', 'fixtures')).sort();
  assert.deepStrictEqual(found, FIXTURES.slice().sort());
});

FIXTURES.forEach(function (file) {
  var res = null, text = null;

  test(file + ' (1) the engine finishes and returns rows', function () {
    text = readFixture(file);
    res = C.clean(text, {});
    assert.strictEqual(res.ok, true, 'clean() did not finish: ' + res.error);
    assert.ok(res.rows.length > 0, 'no cleaned rows came out');
  });

  test(file + ' (2) rows in = rows out + dropped + not parsed', function () {
    assert.ok(res && res.ok, 'no engine result to check');
    var c = res.counts;
    assert.strictEqual(c.rowsOut, res.rows.length);
    assert.strictEqual(c.unparsed, res.unparsed.length);
    assert.strictEqual(c.footer, res.footer.length);
    assert.strictEqual(c.duplicatesDropped, res.duplicates.length);
    assert.strictEqual(c.rowsIn, c.rowsOut + c.duplicatesDropped + c.footer + c.unparsed,
      'rows in ' + c.rowsIn + ' != out ' + c.rowsOut + ' + duplicates ' + c.duplicatesDropped +
      ' + footer ' + c.footer + ' + not parsed ' + c.unparsed);
    assert.strictEqual(c.records, c.header + c.blank + c.preamble + c.repeatedHeaders + c.rowsIn);
    assert.strictEqual(c.records, C.parseCsv(text, res.delimiter).records.length);
  });

  test(file + ' (3) output header is exactly ' + HEADER + ' and every line has 8 columns', function () {
    assert.ok(res && res.ok, 'no engine result to check');
    var out = C.buildCsv(res.rows);
    assert.strictEqual(out.split('\r\n')[0], HEADER);
    var back = C.parseCsv(out, ',').records;
    assert.strictEqual(back.length, res.rows.length + 1);
    back.forEach(function (rec) { assert.strictEqual(rec.cells.length, 8); });
  });

  test(file + ' (4) every date is YYYY-MM-DD and every amount is a plain number', function () {
    assert.ok(res && res.ok, 'no engine result to check');
    res.rows.forEach(function (r) {
      assert.ok(RE_DATE.test(r.date), 'line ' + r.line + ': date "' + r.date + '"');
      assert.ok(RE_AMOUNT.test(r.amount), 'line ' + r.line + ': amount "' + r.amount + '"');
      assert.ok(RE_AMOUNT.test(r.net), 'line ' + r.line + ': net "' + r.net + '"');
      assert.ok(r.fee === '' || RE_AMOUNT.test(r.fee), 'line ' + r.line + ': fee "' + r.fee + '"');
    });
  });
});

test('parseCsv: quoted delimiter, doubled quotes and a line break inside a quoted field', function () {
  var parsed = C.parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\r\nlines",z\r\n', ',');
  assert.strictEqual(parsed.unterminatedQuote, false);
  assert.deepStrictEqual(parsed.records.map(function (r) { return r.cells; }),
    [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', 'z']]);
  assert.deepStrictEqual(parsed.records.map(function (r) { return r.line; }), [1, 2, 3]);
  assert.strictEqual(C.parseCsv('a,b\n"open,1\n', ',').unterminatedQuote, true);
});

test('detectDelimiter: comma, semicolon, tab and the Excel sep= line', function () {
  assert.strictEqual(C.detectDelimiter('Date,Description,Amount\n2024-01-02,A,1.00\n2024-01-03,B,2.00\n'), ',');
  assert.strictEqual(C.detectDelimiter('Date;Description;Amount\n2024-01-02;A;1.00\n2024-01-03;B;2.00\n'), ';');
  assert.strictEqual(C.detectDelimiter('Date\tDescription\tAmount\n2024-01-02\tA\t1.00\n2024-01-03\tB\t2.00\n'), '\t');
  assert.strictEqual(C.detectDelimiter('sep=;\nDate;Amount\n2024-01-02;1\n'), ';');
});

test('detectDelimiter: a semicolon file with decimal commas is read as semicolon', function () {
  assert.strictEqual(C.detectDelimiter('Fecha;Concepto;Importe\n01/03/2024;Luz;-89,90\n13/03/2024;Agua;-12,00\n'), ';');
});

test('parseDate: ISO, compact, month-name and two-digit-year forms', function () {
  assert.strictEqual(C.parseDate('2024-03-05'), '2024-03-05');
  assert.strictEqual(C.parseDate('2024/3/5 09:12:44'), '2024-03-05');
  assert.strictEqual(C.parseDate('20240305'), '2024-03-05');
  assert.strictEqual(C.parseDate('March 3, 2024'), '2024-03-03');
  assert.strictEqual(C.parseDate('02 Apr 2024'), '2024-04-02');
  assert.strictEqual(C.parseDate('02/14/24', 'MDY'), '2024-02-14');
});

test('parseDate: impossible dates and empty values return null', function () {
  assert.strictEqual(C.parseDate('31 Apr 2024'), null);
  assert.strictEqual(C.parseDate('2023-02-29'), null);
  assert.strictEqual(C.parseDate('2024-02-29'), '2024-02-29');
  assert.strictEqual(C.parseDate('14/14/2024', 'DMY'), null);
  assert.strictEqual(C.parseDate(''), null);
  assert.strictEqual(C.parseDate('Closing balance'), null);
});

test('parseDate: an all-numeric date needs an order and is never guessed', function () {
  assert.strictEqual(C.parseDate('03/04/2024'), null);
  assert.strictEqual(C.parseDate('03/04/2024', 'MDY'), '2024-03-04');
  assert.strictEqual(C.parseDate('03/04/2024', 'DMY'), '2024-04-03');
});

var AMBIGUOUS = 'Date,Description,Amount\n03/04/2024,A,1.00\n05/06/2024,B,2.00\n';

test('clean: ambiguous DD/MM vs MM/DD dates stop with no rows until an order is chosen', function () {
  var res = C.clean(AMBIGUOUS, {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.needsDateOrder, true);
  assert.strictEqual(res.rows.length, 0);
  assert.deepStrictEqual(res.dateSamples, ['03/04/2024', '05/06/2024']);
  assert.ok(res.error.length > 0);
});

test('clean: the chosen date order is applied to the same ambiguous file', function () {
  var dmy = C.clean(AMBIGUOUS, { dateOrder: 'DMY' }), mdy = C.clean(AMBIGUOUS, { dateOrder: 'MDY' });
  assert.strictEqual(dmy.ok, true);
  assert.deepStrictEqual(dmy.rows.map(function (r) { return r.date; }), ['2024-04-03', '2024-06-05']);
  assert.strictEqual(mdy.ok, true);
  assert.deepStrictEqual(mdy.rows.map(function (r) { return r.date; }), ['2024-03-04', '2024-05-06']);
});

test('clean: one date with a day above 12 proves the order for the whole file', function () {
  var dmy = C.clean(AMBIGUOUS + '13/06/2024,C,3.00\n', {});
  assert.strictEqual(dmy.ok, true);
  assert.strictEqual(dmy.dateOrder, 'DMY');
  assert.strictEqual(dmy.dateOrderSource, 'detected');
  assert.strictEqual(dmy.rows[0].date, '2024-04-03');
  var mdy = C.clean(AMBIGUOUS + '06/13/2024,C,3.00\n', {});
  assert.strictEqual(mdy.dateOrder, 'MDY');
  assert.strictEqual(mdy.rows[0].date, '2024-03-04');
});

test('clean: a file mixing day-first-only and month-first-only dates also stops', function () {
  var res = C.clean('Date,Description,Amount\n13/06/2024,A,1.00\n06/13/2024,B,2.00\n', {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.needsDateOrder, true);
  assert.strictEqual(res.rows.length, 0);
});

test('parseAmount: decimal-comma amounts', function () {
  assert.strictEqual(C.parseAmount('1.234,56', 'comma').value, '1234.56');
  assert.strictEqual(C.parseAmount('-89,90', 'comma').value, '-89.90');
  assert.strictEqual(C.parseAmount('-1.000', 'comma').value, '-1000.00');
  assert.strictEqual(C.parseAmount('450,00', 'comma').value, '450.00');
  assert.strictEqual(C.parseAmount('1,234', 'comma').value, '1.234');
});

test('parseAmount: decimal-point amounts with thousands commas and currency marks', function () {
  assert.strictEqual(C.parseAmount('1,234', 'dot').value, '1234.00');
  assert.strictEqual(C.parseAmount('5,000.00', 'dot').value, '5000.00');
  assert.strictEqual(C.parseAmount('0.42', 'dot').value, '0.42');
  assert.strictEqual(C.parseAmount('-$1.56', 'dot').value, '-1.56');
  assert.deepStrictEqual(C.parseAmount('£123.45', 'dot'), { ok: true, value: '123.45', currency: 'GBP' });
  assert.deepStrictEqual(C.parseAmount('12.50 EUR', 'dot'), { ok: true, value: '12.50', currency: 'EUR' });
});

test('parseAmount: parentheses and trailing-minus negatives', function () {
  assert.strictEqual(C.parseAmount('(182.40)', 'dot').value, '-182.40');
  assert.strictEqual(C.parseAmount('($45.10)', 'dot').value, '-45.10');
  assert.strictEqual(C.parseAmount('$(1.00)', 'dot').value, '-1.00');
  assert.strictEqual(C.parseAmount('(1,250.00)', 'dot').value, '-1250.00');
  assert.strictEqual(C.parseAmount('(0.00)', 'dot').value, '0.00');
  assert.strictEqual(C.parseAmount('12.50-', 'dot').value, '-12.50');
});

test('parseAmount: text is refused and blank markers are reported as empty', function () {
  assert.deepStrictEqual(C.parseAmount('(n/a)', 'dot'), { ok: false, empty: false });
  assert.deepStrictEqual(C.parseAmount('pendiente', 'comma'), { ok: false, empty: false });
  assert.deepStrictEqual(C.parseAmount('1.2.3', 'dot'), { ok: false, empty: false });
  assert.deepStrictEqual(C.parseAmount('', 'dot'), { ok: false, empty: true });
  assert.deepStrictEqual(C.parseAmount('--', 'dot'), { ok: false, empty: true });
});

test('detectDecimalStyle: comma, dot and the single-separator ambiguous case', function () {
  assert.deepStrictEqual(C.detectDecimalStyle(['1.234,56', '-89,90']), { style: 'comma', ambiguous: false });
  assert.deepStrictEqual(C.detectDecimalStyle(['1,234.56', '12.00']), { style: 'dot', ambiguous: false });
  assert.deepStrictEqual(C.detectDecimalStyle(['1,234', '2,500']), { style: 'dot', ambiguous: true });
});

test('addDecimal: exact string arithmetic', function () {
  assert.strictEqual(C.addDecimal('12.00', '-5.00'), '7.00');
  assert.strictEqual(C.addDecimal('0.10', '0.20'), '0.30');
  assert.strictEqual(C.addDecimal('0.00', '-123.45'), '-123.45');
  assert.strictEqual(C.addDecimal('1.5', '-1.500'), '0.000');
});

test('clean: debit and credit columns are merged into one signed amount', function () {
  var res = C.clean('Date,Description,Debit,Credit\n2024-01-02,A,10.00,\n2024-01-03,B,,25.50\n' +
    '2024-01-04,C,5.00,12.00\n2024-01-05,D,,\n', {});
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.rows.map(function (r) { return r.amount; }), ['-10.00', '25.50', '7.00']);
  assert.deepStrictEqual(res.rows.map(function (r) { return r.net; }), ['-10.00', '25.50', '7.00']);
  assert.strictEqual(res.counts.unparsed, 1);
  assert.strictEqual(res.unparsed[0].line, 5);
  assert.strictEqual(res.unparsed[0].reason, 'debit and credit are both empty');
});

test('clean: decimal-comma semicolon file end to end', function () {
  var res = C.clean('Fecha;Concepto;Importe;Divisa\n13/03/2024;Luz;-1.234,56;EUR\n02/03/2024;Cobro;450,00;EUR\n', {});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.delimiter, ';');
  assert.strictEqual(res.decimalStyle, 'comma');
  assert.strictEqual(C.buildCsv(res.rows), HEADER + '\r\n' +
    '2024-03-13,Luz,-1234.56,EUR,,-1234.56,,bank\r\n2024-03-02,Cobro,450.00,EUR,,450.00,,bank\r\n');
});

var WITH_DUPLICATE = 'Date,Description,Amount\n2024-01-02,A,1.00\n2024-01-03,B,2.00\n2024-01-02,A,1.00\n';

test('clean: an exact duplicate row is dropped and listed', function () {
  var res = C.clean(WITH_DUPLICATE, {});
  assert.strictEqual(res.counts.rowsIn, 3);
  assert.strictEqual(res.counts.rowsOut, 2);
  assert.strictEqual(res.counts.duplicatesDropped, 1);
  assert.deepStrictEqual(res.duplicates.map(function (d) { return [d.line, d.firstLine]; }), [[4, 2]]);
});

test('clean: keepDuplicates keeps the row and still reports it', function () {
  var res = C.clean(WITH_DUPLICATE, { keepDuplicates: true });
  assert.strictEqual(res.counts.rowsOut, 3);
  assert.strictEqual(res.counts.duplicatesDropped, 0);
  assert.strictEqual(res.counts.duplicatesKept, 1);
  assert.strictEqual(res.rows[2].duplicateOf, 2);
});

test('clean: lines above the header and total lines after the data are listed, not output', function () {
  var res = C.clean('Statement export\nAccount,Example\n\nDate,Description,Amount\n2024-01-02,A,1.00\n' +
    'Closing balance,,1.00\n', {});
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.headerLine, 4);
  assert.strictEqual(res.counts.preamble, 2);
  assert.strictEqual(res.counts.footer, 1);
  assert.strictEqual(res.counts.rowsOut, 1);
});

test('clean: a file with no date and amount columns gives an error and no rows', function () {
  var res = C.clean('name,colour\napple,red\npear,green\n', {});
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.rows.length, 0);
  assert.ok(res.error.length > 0);
  assert.strictEqual(C.clean('', {}).ok, false);
});

test('limitRows: caps at the given number and 0 means no cap', function () {
  var rows = [];
  for (var i = 0; i < 25; i++) { rows.push({ n: i }); }
  assert.strictEqual(C.limitRows(rows, PREVIEW_ROWS).length, 20);
  assert.strictEqual(C.limitRows(rows, 0).length, 25);
  assert.strictEqual(C.limitRows(rows.slice(0, 3), PREVIEW_ROWS).length, 3);
});

test('limitRows: the 25-row semicolon fixture is cut to 20 rows', function () {
  var res = C.clean(readFixture('bank-semicolon-decimal-comma-dmy.csv'), {});
  assert.ok(res.rows.length > PREVIEW_ROWS);
  assert.deepStrictEqual(C.limitRows(res.rows, PREVIEW_ROWS), res.rows.slice(0, PREVIEW_ROWS));
});

test('buildCsv: fixed header, CRLF line ends and quoting of commas and quotes', function () {
  assert.strictEqual(C.buildCsv([]), HEADER + '\r\n');
  var out = C.buildCsv([{
    date: '2024-01-02', description: 'Tape, "wide"', amount: '-1.00', currency: 'USD', fee: '',
    net: '-1.00', reference: 'R1', source: 'bank'
  }]);
  assert.strictEqual(out, HEADER + '\r\n2024-01-02,"Tape, ""wide""",-1.00,USD,,-1.00,R1,bank\r\n');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
