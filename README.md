# CSV cleaner engine

A small, dependency-free JavaScript engine that turns messy bank, PayPal and Etsy CSV exports into one tidy CSV with a fixed set of columns. It runs in plain node or in a browser, makes no network calls and writes nothing to disk.

This project is built and maintained by an automated agent system.

## What it does

- Detects the delimiter (comma, semicolon, tab, or an Excel `sep=` line) and reads quoted fields, doubled quotes and line breaks inside quotes.
- Finds the header row, even when there are lines above it, and lists those lines instead of silently dropping them.
- Maps the columns of PayPal activity downloads, Etsy sold-orders files, Etsy monthly statements and generic bank exports (including Spanish, German and French header names).
- Parses dates to `YYYY-MM-DD`. An all-numeric date such as `03/04/2024` is never guessed: the engine uses a day above 12 in the file as proof of the order, and otherwise stops with no rows until you pass `dateOrder: 'DMY'` or `'MDY'`.
- Parses amounts with exact string arithmetic (no floating point): decimal commas or points, thousands separators, currency symbols and codes, parentheses and trailing-minus negatives.
- Merges separate debit and credit columns into one signed amount.
- Drops exact duplicate rows and lists them (or keeps them with `keepDuplicates: true`).
- Lists total lines after the data (such as "Closing balance") as footer lines, and rows it cannot read as "not parsed" with the reason.
- Keeps the books balanced: rows in = rows out + duplicates dropped + footer lines + rows not parsed.

## What it does not do

- It does not read PDF files.
- It does not write `.xlsx` files; the output is CSV only.
- It does not convert currencies. It warns when a file mixes several.
- It does not guess what it cannot read: unreadable rows are reported, not repaired.

## Run it

Requires node 16 or later (it uses `BigInt`). There is nothing to install.

```
node tests/run_tests.js
node example.js
```

`tests/run_tests.js` prints one `ok` or `FAIL` line per check and a final `N passed, M failed`; it exits non-zero if any check fails. `example.js` cleans `fixtures/paypal-activity.csv` and prints a short report followed by the cleaned CSV.

Use it in your own code:

```js
var C = require('./cleaner.js');
var res = C.clean(csvText, { dateOrder: 'DMY' });
if (res.ok) { process.stdout.write(C.buildCsv(res.rows)); }
```

Options of `clean(text, options)`: `profile` (`auto`, `paypal`, `etsy_orders`, `etsy_statement`, `bank`), `delimiter`, `dateOrder` (`DMY` or `MDY`), `decimal` (`dot` or `comma`) and `keepDuplicates`.

## Output columns

The cleaned CSV has this header, CRLF line ends and these eight columns:

| Column | Meaning |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `description` | Text of the row, whitespace collapsed |
| `amount` | Signed plain number with a decimal point |
| `currency` | Currency code from a column or from the amount, if any |
| `fee` | Fee as a plain number, empty when the file has none |
| `net` | Net figure from the file, or amount plus fee where the format defines it |
| `reference` | Transaction, order or check reference, if any |
| `source` | Input format the engine detected (`paypal`, `etsy_orders`, `etsy_statement` or `bank`) |

## Sample data

The fixtures are synthetic sample exports written for the tests and hold no real person's data. The names, order numbers, descriptions and balances are made up, and they are not real accounts or real transactions.

## Browser version

The engine in this repository is free and open source (MIT). The same engine powers a hosted browser site, which shows a free 20-row preview and sells the full-file export for 6 USD: https://augeo-csv-cleaner-free-20-row-preview-of-your-adc5.pages.dev/

## Notes

This is an independent tool. It is not affiliated with or endorsed by PayPal, Etsy, any bank or any other named brand; those names only describe the file layouts it can read. Review the output before you use it. It is not accounting, tax or financial advice. Only process data you have the right to process.

## License

MIT, see `LICENSE`.
