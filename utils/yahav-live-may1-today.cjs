/**
 * Live test: load `.env.local` (BANK_YAHAV_*), scrape Yahav from **1 May (current year, Asia/Jerusalem)** through **today**.
 * Prints all transactions in that window as JSON (no passwords). May include **account number** — do not paste publicly. Requires built `lib/` (`npm run build:js`).
 *
 * Run: node utils/yahav-live-may1-today.cjs
 * Optional: YAHAV_DEBUG_DOM=1 YAHAV_DEBUG_NET=1
 */
const fs = require('fs');
const path = require('path');

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

const moment = require('moment-timezone');

const TZ = 'Asia/Jerusalem';

function inMay1ThroughToday(isoDate) {
  const now = moment.tz(TZ);
  const may1 = moment.tz(TZ).year(now.year()).month(4).date(1).startOf('day');
  const end = now.clone().endOf('day');
  const d = moment(isoDate).tz(TZ);
  return d.isSameOrAfter(may1) && d.isSameOrBefore(end);
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

  const now = moment.tz(TZ);
  const may1 = moment.tz(TZ).year(now.year()).month(4).date(1).startOf('day');
  const startDate = may1.toDate();

  const { createScraper, CompanyTypes } = require('../lib/index.js');
  const showBrowser = process.env.YAHAV_SHOW_BROWSER === '1' || process.env.YAHAV_SHOW_BROWSER === 'true';

  const scraper = createScraper({
    companyId: CompanyTypes.yahav,
    startDate,
    showBrowser,
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

  const window = {
    fromLocal: may1.format('YYYY-MM-DD'),
    toLocal: now.format('YYYY-MM-DD'),
    timezone: TZ,
  };

  const all = [];
  for (const acc of result.accounts || []) {
    for (const txn of acc.txns || []) {
      all.push({
        date: txn.date,
        processedDate: txn.processedDate,
        description: (txn.description || '').trim(),
        chargedAmount: txn.chargedAmount,
        referenceNumber: txn.referenceNumber,
        accountNumber: acc.accountNumber,
      });
    }
  }

  const inWindow = all.filter(t => inMay1ThroughToday(t.date));

  const out = {
    ok: true,
    window,
    accounts: (result.accounts || []).length,
    transactionsTotal: all.length,
    transactionsInWindow: inWindow.length,
    transactions: inWindow,
  };

  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
