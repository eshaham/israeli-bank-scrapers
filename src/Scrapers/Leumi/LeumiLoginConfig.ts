import { type Page } from 'playwright';

import { pageEvalAll, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Leumi];

const LEUMI_INVALID_PASSWORD_MSG = 'אחד או יותר מפרטי ההזדהות שמסרת שגויים. ניתן לנסות שוב';
const LEUMI_ACCOUNT_BLOCKED_MSG = 'המנוי חסום';

async function leumiCheckReadiness(page: Page): Promise<void> {
  await waitUntilElementFound(page, '.enter_account');
  const loginUrl = await page.$eval('.enter_account', el => (el as HTMLAnchorElement).href);
  await page.goto(loginUrl);
  await waitForNavigation(page, { waitUntil: 'networkidle' });
  await Promise.all([
    waitUntilElementFound(page, 'input[placeholder="שם משתמש"]', { visible: true }),
    waitUntilElementFound(page, 'input[placeholder="סיסמה"]', { visible: true }),
    waitUntilElementFound(page, 'button[type="submit"]', { visible: true }),
  ]);
}

async function leumiPostAction(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, 'a[title="דלג לחשבון"]', { visible: true, timeout: 60000 }),
    waitUntilElementFound(page, 'div.main-content', { visible: false, timeout: 60000 }),
    page.waitForSelector(`xpath=//div[contains(string(),"${LEUMI_INVALID_PASSWORD_MSG}")]`),
    waitUntilElementFound(page, 'form[action="/changepassword"]', {
      visible: true,
      timeout: 60000,
    }),
  ]);
}

export const LEUMI_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'username', selectors: [] }, // wellKnown → placeholder שם משתמש
    { credentialKey: 'password', selectors: [] }, // wellKnown → placeholder סיסמה
  ],
  submit: [{ kind: 'css', value: "button[type='submit']" }],
  checkReadiness: leumiCheckReadiness,
  postAction: leumiPostAction,
  possibleResults: {
    success: [/ebanking\/SO\/SPA.aspx/i],
    invalidPassword: [
      async (opts): Promise<boolean> => {
        if (!opts?.page) return false;
        const msg = await pageEvalAll(opts.page, {
          selector: 'svg#Capa_1',
          defaultResult: '',
          callback: el => (el[0]?.parentElement?.children[1] as HTMLDivElement).innerText,
        });
        return msg.startsWith(LEUMI_INVALID_PASSWORD_MSG);
      },
    ],
    accountBlocked: [
      async (opts): Promise<boolean> => {
        if (!opts?.page) return false;
        const msg = await pageEvalAll(opts.page, {
          selector: '.errHeader',
          defaultResult: '',
          callback: el => (el[0] as HTMLElement).innerText,
        });
        return msg.startsWith(LEUMI_ACCOUNT_BLOCKED_MSG);
      },
    ],
    changePassword: ['https://hb2.bankleumi.co.il/authenticate'],
  },
};
