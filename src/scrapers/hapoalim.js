import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import runner from '../adapters/runner';
import { setBrowserPageAdapter } from '../adapters/puppeteer';
import loginAdapter from '../adapters/hapoalim/login';
import scrapeTransactionsAdapter from '../adapters/hapoalim/scrape-transactions';
import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from '../constants';

class HapoalimScraper extends BaseScraperWithBrowser {
  async login(credentials) {
    if (!credentials) {
      return {
        success: false,
        errorType: GENERAL_ERROR,
      };
    }

    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);

    return runner({
      onProgress: (name, status) => {
        this.emitProgress(status);
      },
    },
    [
      setBrowserPageAdapter({
        page: this.page,
      }),
      loginAdapter({
        credentials,
      }),
    ]);
  }

  async fetchData() {
    return runner({
      onProgress: (name, status) => {
        this.emitProgress(status);
      },
    },
    [
      setBrowserPageAdapter({
        page: this.page,
      }),
      scrapeTransactionsAdapter({}),
    ])
      .then(result => {
        if (!result.success) {
          return result;
        }

        return {
          success: true,
          accounts: result.data.hapoalim.transactions.accounts,
        };
      });
  }
}

export default HapoalimScraper;
