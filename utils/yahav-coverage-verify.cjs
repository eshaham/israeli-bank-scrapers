/**
 * Production-like Yahav verification:
 * - Uses createScraper(startDate) like Finance App
 * - Applies local range filter (SCRAPE_START_DATE..SCRAPE_END_DATE) for reporting
 * - Prints scraper-level diagnostics (partial/warnings/diagnostics)
 *
 * Run:
 *   SCRAPE_START_DATE=2026-04-25 SCRAPE_END_DATE=2026-05-13 node utils/yahav-coverage-verify.cjs
 */
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const TZ = 'Asia/Jerusalem';

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath}`);
  }
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function inRange(isoDate, from, to) {
  const d = moment(isoDate).tz(TZ);
  return d.isSameOrAfter(from) && d.isSameOrBefore(to);
}

function isSalaryLike(desc) {
  return /משכורת|שכר|salary/i.test((desc || '').trim());
}

async function main() {
  loadEnvLocal();
  if (!process.env.YAHAV_STATEMENT_MONTHS_BACK) {
    process.env.YAHAV_STATEMENT_MONTHS_BACK = '12';
  }

  const username = process.env.BANK_YAHAV_USERNAME;
  const nationalID = process.env.BANK_YAHAV_ID_NUMBER;
  const password = process.env.BANK_YAHAV_PASSWORD;
  if (!username || !nationalID || !password) {
    throw new Error('Need BANK_YAHAV_USERNAME, BANK_YAHAV_ID_NUMBER, BANK_YAHAV_PASSWORD in .env.local');
  }

  const fromLocal = process.env.SCRAPE_START_DATE || '2026-04-25';
  const toLocal = process.env.SCRAPE_END_DATE || moment().tz(TZ).format('YYYY-MM-DD');
  const from = moment.tz(`${fromLocal}T00:00:00`, TZ);
  const to = moment.tz(`${toLocal}T23:59:59`, TZ);

  const { createScraper, CompanyTypes } = require('../lib/index.js');
  const scraper = createScraper({
    companyId: CompanyTypes.yahav,
    startDate: from.toDate(),
    showBrowser: false,
    verbose: false,
    timeout: 240000,
  });
  const result = await scraper.scrape({ username, nationalID, password });

  const all = [];
  for (const acc of result.accounts || []) {
    for (const txn of acc.txns || []) {
      all.push({
        accountNumber: acc.accountNumber,
        date: txn.date,
        description: (txn.description || '').trim(),
        chargedAmount: txn.chargedAmount,
      });
    }
  }

  const inWindow = all.filter(t => inRange(t.date, from, to));
  const salaryRows = inWindow.filter(t => isSalaryLike(t.description));
  const dates = inWindow.map(t => moment(t.date).tz(TZ).format('YYYY-MM-DD')).sort((a, b) => a.localeCompare(b));

  console.log(
    JSON.stringify(
      {
        success: result.success,
        partial: result.partial === true,
        warnings: result.warnings || [],
        diagnostics: result.diagnostics || null,
        requestedWindow: { from: fromLocal, to: toLocal, timezone: TZ },
        accountsCount: (result.accounts || []).length,
        txnsCountAll: all.length,
        rowsInRange: inWindow.length,
        firstTxnDate: dates[0] || null,
        lastTxnDate: dates[dates.length - 1] || null,
        salaryRowsCount: salaryRows.length,
        salaryRows: salaryRows.map(r => ({
          date: moment(r.date).tz(TZ).format('YYYY-MM-DD'),
          description: r.description,
          chargedAmount: r.chargedAmount,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch(err => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
