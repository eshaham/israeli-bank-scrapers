import { getBrowser, getBrowserPage } from '../helpers/scraping';
import userLogin from './leumi/user-login';
import scrapeTransactions from './leumi/scrape-transactions';
import { BaseScraper } from './base-scraper';
import { SCRAPE_PROGRESS_TYPES } from '../constants';

class LeumiScraper extends BaseScraper {
  async initialize() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);
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
    const userLoginOptions = Object.assign(
      {},
      this.extendedOptions,
      { credentials },
    );
    return userLogin(this.page, userLoginOptions);
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
