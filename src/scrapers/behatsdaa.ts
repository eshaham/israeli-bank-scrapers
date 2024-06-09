import moment from 'moment';
import { getDebug } from '../helpers/debug';
import { waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchPostWithinPage } from '../helpers/fetch';
import { sleep } from '../helpers/waiting';
import { Transaction, TransactionStatuses, TransactionTypes } from '../transactions';
import { BaseScraperWithBrowser, LoginOptions, LoginResults } from './base-scraper-with-browser';
import { ScraperScrapingResult } from './interface';

const BASE_URL = 'https://www.behatsdaa.org.il';
const LOGIN_URL = `${BASE_URL}/login`;
const PURCHASE_HISTORY_URL = 'https://back.behatsdaa.org.il/api/purchases/purchaseHistory';

const debug = getDebug('behatsdaa');

type ScraperSpecificCredentials = { id: string, password: string };

type Variant = {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string; // ISO timestamp with no timezone
  tTransactionID: string;
};

type PurchaseHistoryResponse = {
  data?: {
    errorDescription?: string;
    memberId: string;
    variants: Variant[];
  };
  errorDescription?: string;
};

function variantToTransaction(variant: Variant): Transaction {
  // The price is positive, make it negative as it's an expense
  const originalAmount = -variant.customerPrice;
  return {
    type: TransactionTypes.Normal,
    identifier: variant.tTransactionID,
    date: moment(variant.orderDate).format('YYYY-MM-DD'),
    processedDate: moment(variant.orderDate).format('YYYY-MM-DD'),
    originalAmount,
    originalCurrency: 'ILS',
    chargedAmount: originalAmount,
    chargedCurrency: 'ILS',
    description: variant.name,
    status: TransactionStatuses.Completed,
    memo: variant.variantName,
  };
}

class BehatsdaaScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  public getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    return {
      loginUrl: LOGIN_URL,
      fields: [
        { selector: '#loginId', value: credentials.id },
        { selector: '#loginPassword', value: credentials.password },
      ],
      checkReadiness: async () => {
        await Promise.all([
          waitUntilElementFound(this.page, '#loginPassword'),
          waitUntilElementFound(this.page, '#loginId'),
        ]);
      },
      possibleResults: {
        [LoginResults.Success]: [`${BASE_URL}/`],
        [LoginResults.InvalidPassword]: ['.custom-input-error-label'],
      },
      submitButtonSelector: async () => {
        await sleep(1000);
        debug('Trying to find submit button');
        const button = await this.page.$('xpath=//button[contains(., "התחברות")]');
        if (button) {
          debug('Submit button found');
          await button.click();
        } else {
          debug('Submit button not found');
        }
      },
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      debug('Token not found in local storage');
      return {
        success: false,
        errorMessage: 'TokenNotFound',
      };
    }

    const body = {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: null,
    };

    debug('Fetching data');

    const res = await fetchPostWithinPage<PurchaseHistoryResponse>(this.page, PURCHASE_HISTORY_URL, body, {
      authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      organizationid: '20',
    });

    debug('Data fetched');

    if (res?.errorDescription || res?.data?.errorDescription) {
      debug('Error fetching data', res.errorDescription || res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }

    if (!res?.data) {
      debug('No data found');
      return { success: false, errorMessage: 'NoData' };
    }

    debug('Data fetched successfully');
    return {
      success: true,
      accounts: [{
        accountNumber: res.data.memberId,
        txns: res.data.variants.map(variantToTransaction),
      }],
    };
  }
}

export default BehatsdaaScraper;
