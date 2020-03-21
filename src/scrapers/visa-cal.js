import moment from 'moment';
import runner from '../runner';
import { loginAdapter, scrapeTransactionsAdapter } from '../visa-cal/adapters';
import { GENERAL_ERROR, SCRAPE_PROGRESS_TYPES } from '../constants';
import { BaseScraper } from './base-scraper';
import { setSessionData, exportSessionData } from '../session';

const DefaultStartMoment = moment().subtract(1, 'years').add(1, 'day');

class VisaCalScraper extends BaseScraper {
  async login(credentials) {
    if (!credentials) {
      return {
        success: false,
        errorType: GENERAL_ERROR,
      };
    }

    this.emitProgress(SCRAPE_PROGRESS_TYPES.INITIALIZING);

    const result = await runner({
      onProgress: (name, status) => {
        this.emitProgress(status);
      },
    },
    [
      loginAdapter({
        credentials,
      }),
      exportSessionData({
        sessionDataKey: 'visaCal.authHeader',
        targetProperty: 'authHeader',
      }),
    ]);

    if (result.success) {
      this.authHeader = result.data.authHeader;
    }

    return {
      success: result.success,
    };
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
      setSessionData({
        sessionDataKey: 'visaCal.authHeader',
        sessionDataValue: this.authHeader,
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
          accounts: result.data.visaCal.transactions.accounts,
        };
      });
  }
}

export default VisaCalScraper;
