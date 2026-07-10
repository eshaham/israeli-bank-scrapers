import { waitUntilElementFound } from '../helpers/elements-interactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { BASE_URL, fetchAccountData, navigateOrErrorLabel } from './discount';

type ScraperSpecificCredentials = { id: string; password: string };

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    // the business site is deployed as /apollo/business, /apollo/business2, /apollo/business3 etc.
    new RegExp(`^${BASE_URL}/apollo/business\\d*/`),
  ];
  urls[LoginResults.InvalidPassword] = [
    // a failed login attempt keeps the SPA on the login route and shows an inline error
    `${BASE_URL}/login/#/LOGIN_PAGE_SME`,
    `${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE_SME`,
  ];
  urls[LoginResults.ChangePassword] = [
    `${BASE_URL}/login/#/PWD_RENEW`,
    `${BASE_URL}/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW`,
  ];
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: '#tzId', value: credentials.id },
    { selector: '#tzPassword', value: credentials.password },
  ];
}

class DiscountBusinessScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: `${BASE_URL}/login/#/LOGIN_PAGE_SME`,
      checkReadiness: async () => waitUntilElementFound(this.page, '#tzId'),
      fields: createLoginFields(credentials),
      submitButtonSelector: '.sendBtn',
      postAction: async () => navigateOrErrorLabel(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    // the business SPA keeps redirecting for a short while after a successful login;
    // a fetch injected during one of those navigations gets its execution context
    // destroyed, so let the page settle first
    await this.page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => {});
    return fetchAccountData(
      this.page,
      this.options,
      'userAccounts/bsUserAccountsData?FetchAccountsNickName=true&FirstTimeEntry=false',
    );
  }
}

export default DiscountBusinessScraper;
