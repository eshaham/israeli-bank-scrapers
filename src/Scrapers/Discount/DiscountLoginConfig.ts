import { type Page } from 'playwright';

import { waitUntilElementFound } from '../../Common/ElementsInteractions';
import { waitForNavigation } from '../../Common/Navigation';
import { type LoginConfig } from '../Base/LoginConfig';

async function discountPostAction(page: Page): Promise<void> {
  try {
    await waitForNavigation(page);
  } catch {
    await waitUntilElementFound(page, '#general-error', { visible: false, timeout: 100 });
  }
}

const DISCOUNT_FIELDS: LoginConfig['fields'] = [
  { credentialKey: 'id', selectors: [] }, // wellKnown → #tzId
  { credentialKey: 'password', selectors: [] }, // wellKnown → #tzPassword
  { credentialKey: 'num', selectors: [] }, // wellKnown → #aidnum
];

const DISCOUNT_POSSIBLE_RESULTS: LoginConfig['possibleResults'] = {
  success: [
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
    'https://start.telebank.co.il/apollo/retail2/',
  ],
  invalidPassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
  ],
  changePassword: [
    'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
  ],
};

export function discountConfig(loginUrl: string): LoginConfig {
  return {
    loginUrl,
    fields: DISCOUNT_FIELDS,
    submit: [{ kind: 'css', value: '.sendBtn' }],
    checkReadiness: async (page: Page): Promise<void> => {
      await waitUntilElementFound(page, '#tzId');
    },
    postAction: discountPostAction,
    possibleResults: DISCOUNT_POSSIBLE_RESULTS,
  };
}
