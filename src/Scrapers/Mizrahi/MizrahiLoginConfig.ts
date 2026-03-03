import { type Page } from 'playwright';

import {
  waitUntilElementDisappear,
  waitUntilElementFound,
} from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const MIZRAHI_CHECKING_ACCOUNT_HE = 'עובר ושב';
const MIZRAHI_CHECKING_ACCOUNT_EN = 'Checking Account';
const MIZRAHI_INVALID_SELECTOR =
  'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';

async function mizrahiIsLoggedIn(opts?: { page?: Page }): Promise<boolean> {
  if (!opts?.page) return false;
  const xpath = `//a//span[contains(., "${MIZRAHI_CHECKING_ACCOUNT_HE}") or contains(., "${MIZRAHI_CHECKING_ACCOUNT_EN}")]`;
  return (await opts.page.$$(`xpath=${xpath}`)).length > 0;
}

async function mizrahiPostAction(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, '#dropdownBasic'),
    waitUntilElementFound(page, MIZRAHI_INVALID_SELECTOR),
    waitForNavigation(page),
  ]);
}

export const MIZRAHI_CONFIG: LoginConfig = {
  loginUrl: SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.base,
  fields: [
    { credentialKey: 'username', selectors: [{ kind: 'css', value: '#userNumberDesktopHeb' }] },
    { credentialKey: 'password', selectors: [{ kind: 'css', value: '#passwordDesktopHeb' }] },
  ],
  submit: [{ kind: 'css', value: 'button.btn.btn-primary' }],
  checkReadiness: async (page: Page) => {
    const loginRoute = SCRAPER_CONFIGURATION.banks[CompanyTypes.Mizrahi].urls.loginRoute;
    await page.goto(loginRoute, { waitUntil: 'domcontentloaded' });
    await waitUntilElementDisappear(page, 'div.ngx-overlay.loading-foreground');
  },
  postAction: mizrahiPostAction,
  possibleResults: {
    success: [/https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/i, mizrahiIsLoggedIn],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await opts.page.$(MIZRAHI_INVALID_SELECTOR))),
    ],
    changePassword: [/https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/],
  },
};
