import { type Page } from 'playwright';

import { waitForRedirect } from '../../Common/Navigation';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Hapoalim];

export const HAPOALIM_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: [
    { credentialKey: 'userCode', selectors: [] }, // wellKnown → #userCode
    { credentialKey: 'password', selectors: [] }, // wellKnown → #password
  ],
  submit: [
    { kind: 'css', value: '.login-btn' },
    // ariaLabel 'כניסה' fallback is now in wellKnownSelectors.__submit__
  ],
  postAction: async (page: Page) => {
    await waitForRedirect(page, {});
  },
  possibleResults: {
    success: [
      'https://login.bankhapoalim.co.il/portalserver/HomePage',
      'https://login.bankhapoalim.co.il/ng-portals-bt/rb/he/homepage',
      'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage',
    ],
    invalidPassword: [
      'https://login.bankhapoalim.co.il/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false',
    ],
    changePassword: [
      'https://login.bankhapoalim.co.il/MCP/START?flow=MCP&state=START&expiredDate=null',
      /\/ABOUTTOEXPIRE\/START/i,
    ],
  },
};
