import { type Page } from 'playwright';

import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Behatsdaa];

// Behatsdaa and BeyahadBishvilha share the same login form selectors
// (selectors: [] — wellKnown finds #loginId and #loginPassword)
export const HISTBASED_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [] }, // wellKnown → #loginId
  { credentialKey: 'password', selectors: [] }, // wellKnown → #loginPassword
];

export const BEHATSDAA_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: HISTBASED_FIELDS,
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחברות")]' },
    // ariaLabel 'התחברות' fallback is now in wellKnownSelectors.__submit__
  ],
  checkReadiness: async (page: Page) => {
    await page.goto(`${CFG.urls.base}/login`);
  },
  possibleResults: {
    success: [`${CFG.urls.base}/`],
    invalidPassword: [
      async (opts): Promise<boolean> =>
        !!(opts?.page && (await elementPresentOnPage(opts.page, '.custom-input-error-label'))),
    ],
  },
};
