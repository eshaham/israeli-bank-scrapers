#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env' + '.local');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    if (hidden) {
      rl.stdoutMuted = true;
      rl._writeToOutput = function writeMasked(output) {
        if (rl.stdoutMuted) {
          rl.output.write('*');
          return;
        }
        rl.output.write(output);
      };
    }

    rl.question(question, value => {
      rl.close();
      if (hidden) {
        process.stdout.write('\n');
      }
      resolve((value || '').trim());
    });
  });
}

async function getCredentials() {
  loadEnvLocal();

  let username = (process.env.BANK_YAHAV_USERNAME || '').trim();
  let nationalID = (process.env.BANK_YAHAV_ID_NUMBER || '').trim();
  let password = process.env.BANK_YAHAV_PASSWORD || '';

  if (!username) {
    username = await ask('BANK_YAHAV_USERNAME: ');
  }
  if (!nationalID) {
    nationalID = await ask('BANK_YAHAV_ID_NUMBER: ');
  }
  if (!password) {
    password = await ask('BANK_YAHAV_PASSWORD (hidden): ', true);
  }

  if (!username || !nationalID || !password) {
    throw new Error('Missing required Yahav credentials.');
  }

  return { username, nationalID, password };
}

function getModule() {
  try {
    return require(path.resolve(process.cwd(), 'lib'));
  } catch {
    throw new Error('Built package not found. Run `npm run build` first.');
  }
}

function sanitizeErrorMessage(message) {
  if (!message) {
    return '';
  }
  return String(message)
    .replace(/BANK_YAHAV_PASSWORD=[^\s]+/g, 'BANK_YAHAV_PASSWORD=***')
    .replace(/password[=:]\s*[^,\s]+/gi, 'password=***')
    .replace(/\b\d{7,10}\b/g, '***');
}

function classifyManualStep(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();
  if (msg.includes('captcha') || msg.includes('otp') || msg.includes('mfa') || msg.includes('verification')) {
    return 'manual-auth-step';
  }
  return '';
}

async function run() {
  const { createScraper, CompanyTypes } = getModule();
  const credentials = await getCredentials();

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 3);

  const options = {
    companyId: CompanyTypes.yahav,
    startDate,
    showBrowser: true,
    verbose: false,
    storeFailureScreenShotPath: false,
    defaultTimeout: 45000,
  };

  console.log('[yahav-live-check] Starting secure live check...');
  const scraper = createScraper(options);
  const startedAt = Date.now();
  scraper.onProgress((_companyId, payload) => {
    const t = String(Date.now() - startedAt).padStart(6, ' ');
    console.log(`[yahav-live-check] +${t}ms progress=${payload.type}`);
  });
  const result = await scraper.scrape(credentials);

  if (!result.success) {
    const message = sanitizeErrorMessage(result.errorMessage || result.errorType || 'Unknown error');
    const manual = classifyManualStep(message);
    console.error(`[yahav-live-check] FAILED: ${message}`);
    if (manual) {
      console.error('[yahav-live-check] Manual step required (MFA/OTP/CAPTCHA). Complete manually and re-run.');
    }
    process.exitCode = 1;
    return;
  }

  const accounts = Array.isArray(result.accounts) ? result.accounts.length : 0;
  console.log(`[yahav-live-check] SUCCESS: login+fetch completed. Accounts: ${accounts}`);
  console.log('[yahav-live-check] Browser session closed by scraper terminate().');
}

run().catch(error => {
  const message = sanitizeErrorMessage(error?.message || error);
  console.error(`[yahav-live-check] ERROR: ${message}`);
  process.exitCode = 1;
});
