/**
 * Local smoke: load .env.local (BANK_YAHAV_*), scrape Yahav, require >=2 May rows whose description suggests salary.
 * Run: node utils/yahav-may-salary-smoke.cjs
 * Exit 0 only if condition met. Does not print secrets.
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

function isMayJerusalem(isoDate) {
  return moment(isoDate).tz('Asia/Jerusalem').month() === 4; // 0-based; 4 = May
}

function looksLikeSalaryDescription(desc) {
  const d = (desc || '').trim();
  return /משכורת|\/משכורת|שכר\s/i.test(d);
}

async function main() {
  loadEnvLocal();
  if (!process.env.YAHAV_STATEMENT_MONTHS_BACK) {
    process.env.YAHAV_STATEMENT_MONTHS_BACK = '6';
  }
  const username = process.env.BANK_YAHAV_USERNAME;
  const nationalID = process.env.BANK_YAHAV_ID_NUMBER;
  const password = process.env.BANK_YAHAV_PASSWORD;
  if (!username || !nationalID || !password) {
    throw new Error('Need BANK_YAHAV_USERNAME, BANK_YAHAV_ID_NUMBER, BANK_YAHAV_PASSWORD in .env.local');
  }

  const { createScraper, CompanyTypes } = require('../lib/index.js');
  const startDate = new Date('2026-03-01T00:00:00.000Z');

  const scraper = createScraper({
    companyId: CompanyTypes.yahav,
    startDate,
    showBrowser: false,
    verbose: false,
    timeout: 180000,
  });

  const result = await scraper.scrape({ username, nationalID, password });

  if (!result.success) {
    console.log(
      JSON.stringify({
        ok: false,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
      }),
    );
    process.exit(1);
  }

  const maySalary = [];
  const mayAll = [];
  let total = 0;
  for (const acc of result.accounts || []) {
    for (const txn of acc.txns || []) {
      total += 1;
      if (!isMayJerusalem(txn.date)) {
        continue;
      }
      const desc = (txn.description || '').trim();
      mayAll.push({ date: txn.date, description: desc.slice(0, 120) });
      if (looksLikeSalaryDescription(desc)) {
        maySalary.push({ date: txn.date, description: desc, amount: txn.chargedAmount });
      }
    }
  }

  const out = {
    ok: true,
    transactionsTotal: total,
    mayRows: mayAll.length,
    maySalaryCount: maySalary.length,
    maySalary,
    mayDescriptionsSample: mayAll.slice(0, 25).map(r => r.description),
  };
  console.log(JSON.stringify(out, null, 2));

  if (maySalary.length < 2) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
