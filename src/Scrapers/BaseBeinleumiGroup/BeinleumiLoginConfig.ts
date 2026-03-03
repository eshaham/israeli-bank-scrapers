import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { sleep } from '../../Common/Waiting';
import { type LoginConfig } from '../Base/LoginConfig';

async function beinleumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('#card-header'),
    page.waitForSelector('#account_num'),
    page.waitForSelector('#matafLogoutLink'),
    page.waitForSelector('#validationMsg'),
    page.waitForSelector('[class*="account-summary"]', { timeout: 30000 }),
  ]).catch(() => {
    // intentionally ignore timeout — any matched selector is sufficient
  });
}

const BEINLEUMI_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'username', selectors: [] }, // wellKnown → #username
  { credentialKey: 'password', selectors: [] }, // wellKnown → #password
];

const BEINLEUMI_SUBMIT: LoginConfig['submit'] = [
  { kind: 'css', value: '#continueBtn' },
  // ariaLabel 'כניסה' fallback is now in wellKnownSelectors.__submit__
];

const BEINLEUMI_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [/fibi.*accountSummary/, /Resources\/PortalNG\/shell/, /FibiMenu\/Online/],
  invalidPassword: [/FibiMenu\/Marketing\/Private\/Home/],
};

async function beinleumiPreAction(page: Page): Promise<Frame | undefined> {
  const hasTrigger = await elementPresentOnPage(page, 'a.login-trigger');
  if (hasTrigger) {
    await page.evaluate(() => {
      const el = document.querySelector('a.login-trigger');
      if (el instanceof HTMLElement) el.click();
    });
    await sleep(2000);
  } else {
    await sleep(1000);
  }
  return undefined;
}

export function beinleumiConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: BEINLEUMI_FIELDS,
    submit: BEINLEUMI_SUBMIT,
    preAction: beinleumiPreAction,
    postAction: beinleumiPostAction,
    possibleResults: BEINLEUMI_POSSIBLE_RESULTS,
  };
}
