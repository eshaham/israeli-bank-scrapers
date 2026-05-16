/**
 * Live probe in a wide date window around 01/05.
 * Loads .env.local BANK_YAHAV_* and scrapes with startDate only (same model as financial app).
 *
 * Run example:
 *   YAHAV_DEBUG_DOM=1 node utils/yahav-wide-window-probe.cjs
 *
 * Optional env:
 *   PROBE_FROM=2026-04-20
 *   PROBE_TO=2026-05-13
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

function looksLikeSalary(desc) {
  return /משכורת|\/משכורת|שכר\s/i.test((desc || '').trim());
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

  const fromLocal = process.env.PROBE_FROM || '2026-04-20';
  const toLocal = process.env.PROBE_TO || '2026-05-13';
  const from = moment.tz(`${fromLocal}T00:00:00`, TZ);
  const to = moment.tz(`${toLocal}T23:59:59`, TZ);

  const { createScraper, CompanyTypes } = require('../lib/index.js');
  const scraper = createScraper({
    companyId: CompanyTypes.yahav,
    startDate: from.toDate(),
    showBrowser: process.env.YAHAV_SHOW_BROWSER === '1' || process.env.YAHAV_SHOW_BROWSER === 'true',
    verbose: false,
    timeout: 240000,
  });

  const result = await scraper.scrape({ username, nationalID, password });
  if (!result.success) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          errorType: result.errorType,
          errorMessage: result.errorMessage,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const all = [];
  for (const acc of result.accounts || []) {
    for (const txn of acc.txns || []) {
      all.push({
        date: txn.date,
        description: (txn.description || '').trim(),
        chargedAmount: txn.chargedAmount,
        referenceNumber: txn.referenceNumber,
        accountNumber: acc.accountNumber,
      });
    }
  }

  const inWindow = all.filter(t => {
    const d = moment(t.date).tz(TZ);
    return d.isSameOrAfter(from) && d.isSameOrBefore(to);
  });
  const salaryRows = inWindow.filter(t => looksLikeSalary(t.description));
  const sortedDates = inWindow
    .map(t => moment(t.date).tz(TZ).format('YYYY-MM-DD'))
    .sort((a, b) => a.localeCompare(b));

  console.log(
    JSON.stringify(
      {
        ok: true,
        timezone: TZ,
        requestedWindow: { from: fromLocal, to: toLocal },
        txnsTotal: all.length,
        rowsInWindow: inWindow.length,
        firstTxnDate: sortedDates[0] || null,
        lastTxnDate: sortedDates[sortedDates.length - 1] || null,
        salaryRowsCount: salaryRows.length,
        salaryRows: salaryRows.map(t => ({
          date: moment(t.date).tz(TZ).format('YYYY-MM-DD'),
          description: t.description,
          chargedAmount: t.chargedAmount,
        })),
        sampleRows: inWindow.slice(0, 12).map(t => ({
          date: moment(t.date).tz(TZ).format('YYYY-MM-DD'),
          description: t.description.slice(0, 100),
          chargedAmount: t.chargedAmount,
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
