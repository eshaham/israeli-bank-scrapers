import { waitUntilElementFound } from '../helpers/elements-interactions';
import { sleep } from '../helpers/waiting';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { BASE_URL, fetchAccountData } from './discount';

// The business site lists accounts through its own endpoint; transactions use the shared one.
const BUSINESS_ACCOUNTS_PATH = 'userAccounts/bsUserAccountsData?FetchAccountsNickName=true&FirstTimeEntry=false';
const LOGIN_TIMEOUT_SECONDS = 45;

type ScraperSpecificCredentials = { id: string; password: string };

function getPossibleLoginResults(): PossibleLoginResults {
  return {
    [LoginResults.Success]: [/apollo\/business\d*\//],
    [LoginResults.InvalidPassword]: [/LOGIN_PAGE_SME/],
    [LoginResults.ChangePassword]: [/PWD_RENEW/],
  };
}

class DiscountBusinessScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    const { page } = this;
    return {
      loginUrl: `${BASE_URL}/login/#/LOGIN_PAGE_SME`,
      checkReadiness: async () => waitUntilElementFound(page, '#tzId'),
      // The business form only registers typed input, so type into the fields and submit with Enter.
      preAction: async () => {
        await page.click('#tzId');
        await page.type('#tzId', credentials.id, { delay: 50 });
        await page.click('#tzPassword');
        await page.type('#tzPassword', credentials.password, { delay: 50 });
      },
      fields: [],
      submitButtonSelector: async () => page.keyboard.press('Enter'),
      postAction: async () => {
        // The page navigates while we wait, so poll the URL rather than waiting on a page function.
        for (let i = 0; i < LOGIN_TIMEOUT_SECONDS; i++) {
          await sleep(1000);
          if (/apollo\/business|PWD_RENEW/.test(page.url())) break;
          if (await page.$('#general-error').catch(() => null)) break;
        }
        // The business app keeps redirecting internally right after login; fetch only once it settles.
        await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
      },
      possibleResults: getPossibleLoginResults(),
    };
  }

  async fetchData() {
    return fetchAccountData(this.page, this.options, BUSINESS_ACCOUNTS_PATH);
  }
}

export default DiscountBusinessScraper;
