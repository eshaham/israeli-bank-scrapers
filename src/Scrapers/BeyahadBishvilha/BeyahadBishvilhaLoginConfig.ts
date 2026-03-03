import { type Page } from 'playwright';

import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { HISTBASED_FIELDS } from '../Behatsdaa/BehatsdaaLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.BeyahadBishvilha];

export const BEYAHAD_CONFIG: LoginConfig = {
  loginUrl: CFG.urls.base,
  fields: HISTBASED_FIELDS,
  submit: [
    { kind: 'xpath', value: '//button[contains(., "התחבר")]' },
    // ariaLabel 'התחבר' fallback is now in wellKnownSelectors.__submit__
  ],
  checkReadiness: async (page: Page) => {
    await page.goto(`${CFG.urls.base}/login`);
  },
  possibleResults: { success: [`${CFG.urls.base}/`] },
};
