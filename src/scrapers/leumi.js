import { getBrowser, getBrowserPage } from '../helpers/scraping';
import login from './leumi/login';
import scrapeTransactions from './leumi/scrape-transactions';
import { BaseScraper } from './base-scraper';
import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from '../constants';
import { isValidCredentials } from '../definitions';

const SCRAPER_ID = 'leumi';

class LeumiScraper extends BaseScraper {
  async initialize() {
    this.browser = this.options.browser || await getBrowser(this.options);
    this.page = await getBrowserPage(this.browser);
    this.extendedOptions = Object.assign(
      {},
      this.options,
      {
        emitProgress: this.emitProgress.bind(this),
      },
    );
  }

  async login(credentials) {
    if (!isValidCredentials(SCRAPER_ID, credentials)) {
      return {
        success: false,
        errorType: GENERAL_ERROR,
      };
    }

    const userLoginOptions = Object.assign(
      {},
      this.extendedOptions,
      { credentials },
    );
    return login(this.page, userLoginOptions);
  }

  async fetchData() {
    return scrapeTransactions(this.page, this.extendedOptions);
  }

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
    await this.browser.close();
  }
}

export default LeumiScraper;
