import { type ElementHandle, type Frame, type Page } from 'puppeteer';
import { getDebug } from '../helpers/debug';
import { sleep } from '../helpers/waiting';

const debug = getDebug('beinleumi-otp');

// The one-time-code flow of the login page (Transmit Security). After the password it may ask
// to pick a phone (SMS / voice) and then for the code sent to it.
export const OTP_SEND_BUTTON = '#sendSms';
export const OTP_CODE_INPUT = '#codeinput';
const OTP_SMS_TAB = '#type2';
const OTP_SMS_TARGETS = '#otpTargetSelectionSms .itemwrapper';
const OTP_TARGET_LABEL = 'span[dir=ltr]';
const OTP_SUBMIT_BUTTON = '.otpSubmitButton';
const OTP_WRONG_CODE = '#wrongCode';
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESULT_TIMEOUT_MS = 40000;

export class OtpRetrieverMissingError extends Error {
  constructor() {
    super('The bank asked for a one-time code sent by SMS, but no otpCodeRetriever was provided in the credentials');
  }
}

export interface OtpCredentials {
  otpCodeRetriever?: () => Promise<string>;
  otpPhoneLastDigits?: string;
}

// Queries made while the bank navigates to its next page throw "Execution context was destroyed";
// for polling purposes that just means "not there yet".
async function isVisible(page: Page | Frame, selector: string) {
  try {
    return await page.$eval(selector, el => !!(el as HTMLElement).offsetParent || el.getClientRects().length > 0);
  } catch {
    return false;
  }
}

/**
 * Picks the phone to send the code to: the masked number ending with `lastDigits`
 * (e.g. "******1234" for "1234"), otherwise the first one listed.
 */
export function pickOtpTarget(targets: string[], lastDigits?: string): number {
  if (!targets.length) return -1;
  const wanted = (lastDigits || '').replace(/\D/g, '');
  if (wanted) {
    const index = targets.findIndex(target => {
      const shown = target.replace(/\D/g, '');
      return shown.length > 0 && (wanted.endsWith(shown) || shown.endsWith(wanted));
    });
    if (index >= 0) return index;
  }
  return 0;
}

export async function isOtpRequested(page: Page) {
  return (await isVisible(page, OTP_SEND_BUTTON)) || (await isVisible(page, OTP_CODE_INPUT));
}

async function sendCodeToPhone(page: Page, lastDigits?: string) {
  if (await page.$(OTP_SMS_TAB)) {
    await page.$eval(OTP_SMS_TAB, el => (el as HTMLElement).click());
    await sleep(300);
  }
  const rows: ElementHandle[] = await page.$$(OTP_SMS_TARGETS);
  const labels = await Promise.all(
    rows.map(row => row.$eval(OTP_TARGET_LABEL, el => (el.textContent || '').trim()).catch(() => '')),
  );
  const index = pickOtpTarget(labels, lastDigits);
  if (index >= 0) {
    debug(`sending the code to phone #${index + 1} of ${labels.length}`);
    await rows[index].$eval('button', el => (el as HTMLElement).click());
    await sleep(300);
  }
  await page.$eval(OTP_SEND_BUTTON, el => (el as HTMLElement).click());
  await page.waitForSelector(OTP_CODE_INPUT, { visible: true, timeout: 30000 });
}

/**
 * Submits one code. A correct code makes the page submit its login form (a main-frame
 * navigation); a wrong one redraws the code form with an error, replacing the old input.
 */
async function submitCode(page: Page, code: string): Promise<'accepted' | 'wrong'> {
  const oldInput = await page.$(OTP_CODE_INPUT);
  await page.$eval(OTP_CODE_INPUT, el => {
    (el as HTMLInputElement).value = '';
  });
  await page.type(OTP_CODE_INPUT, code);

  let navigated = false;
  const onNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) navigated = true;
  };
  page.on('framenavigated', onNavigation);
  try {
    await page.$eval(OTP_SUBMIT_BUTTON, el => (el as HTMLElement).click());
    const end = Date.now() + OTP_RESULT_TIMEOUT_MS;
    while (Date.now() < end) {
      if (navigated) return 'accepted';
      const replaced = oldInput ? await oldInput.evaluate(el => !el.isConnected).catch(() => true) : true;
      // Wait for the old form to be replaced first, so a previous attempt's error isn't read.
      if (replaced && (await isVisible(page, OTP_WRONG_CODE))) return 'wrong';
      await sleep(500);
    }
    return 'accepted';
  } finally {
    page.off('framenavigated', onNavigation);
  }
}

export async function completeOtp(page: Page, credentials: OtpCredentials) {
  if (!credentials.otpCodeRetriever) throw new OtpRetrieverMissingError();

  if (await isVisible(page, OTP_SEND_BUTTON)) {
    await sendCodeToPhone(page, credentials.otpPhoneLastDigits);
  }

  for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
    debug(`waiting for the one-time code (attempt ${attempt})`);
    const code = String(await credentials.otpCodeRetriever()).replace(/\D/g, '');
    if ((await submitCode(page, code)) === 'accepted') {
      debug('one-time code accepted');
      return;
    }
    debug('the bank rejected the one-time code');
  }
  throw new Error(`The bank rejected the one-time code ${OTP_MAX_ATTEMPTS} times`);
}
