import moment from 'moment';
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import runner from '../adapters/runner';
import { setBrowserPageAdapter } from '../adapters/puppeteer';
import loginAdapter from '../adapters/leumi/login';
import scrapeTransactionsAdapter from '../adapters/leumi/scrape-transactions';
import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from '../constants';

const DefaultStartMoment = moment().subtract(1, 'years').add(1, 'day');

class LeumiScraper extends BaseScraperWithBrowser {
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
    const startDate = this.options.startDate || DefaultStartMoment.toDate();
    const startMoment = moment.max(DefaultStartMoment, moment(startDate));

    return runner({
      onProgress: (name, status) => {
        this.emitProgress(status);
      },
    },
    [
      setBrowserPageAdapter({
        page: this.page,
      }),
      scrapeTransactionsAdapter({
        startDate: startMoment,
      }),
    ])
      .then((result) => {
        if (!result.success) {
          return result;
        }

        return {
          success: true,
          accounts: result.data.leumi.transactions.accounts,
        };
      });
  }
}

export default LeumiScraper;
