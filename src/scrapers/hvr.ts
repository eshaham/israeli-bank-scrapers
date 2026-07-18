import moment from 'moment';
import {
  SHEKEL_CURRENCY,
} from '../constants';
import { getDebug } from '../helpers/debug';
import { pageEvalAll, waitUntilElementFound } from '../helpers/elements-interactions';
import { getRawTransaction, filterOldTransactions } from '../helpers/transactions';
import { TransactionStatuses, TransactionTypes, type Transaction } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';

const debug = getDebug('hvr');

const BASE_URL = 'https://www.hvr.co.il';
const LOGIN_URL = `${BASE_URL}/signin.aspx?bs=1`;
const SHEL_KEVA_URL = `${BASE_URL}/orders/gift_2000.aspx`;
const TEAMIM_URL = `${BASE_URL}/orders/gift_teamim.aspx`;
const ORDER_LIST_URL = `${BASE_URL}/orders/orderlist.aspx`;

const DATE_FORMAT = 'DD/MM/YYYY';

interface ScrapedTransaction {
  date: string;
  description: string;
  amount: string;
}

interface ScrapedOrder {
  orderNumber: string;
  date: string;
  description: string;
  amount: string;
}

function parseAmount(amountStr: string) {
  if (!amountStr) return 0;
  const amountStrCln = amountStr.replace(/[^\d.-]/g, '');
  const parsed = parseFloat(amountStrCln);
  return isNaN(parsed) ? 0 : parsed;
}

function convertTransactions(txns: ScrapedTransaction[], options?: ScraperOptions): Transaction[] {
  const dateFormat = (options as any)?.DATE_FORMAT || DATE_FORMAT;
  return txns.map((txn) => {
    const amount = parseAmount(txn.amount);
    const txnDate = moment(txn.date, dateFormat);

    const result: Transaction = {
      type: TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      date: txnDate.toISOString(),
      processedDate: txnDate.toISOString(),
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      chargedCurrency: SHEKEL_CURRENCY,
      description: txn.description || '',
      memo: '',
    };

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(txn);
    }

    return result;
  });
}

function convertOrders(orders: ScrapedOrder[], options?: ScraperOptions): Transaction[] {
  const dateFormat = (options as any)?.DATE_FORMAT || DATE_FORMAT;
  return orders.map((order) => {
    const amount = parseAmount(order.amount);
    const txnDate = moment(order.date, dateFormat);

    const result: Transaction = {
      type: TransactionTypes.Normal,
      status: TransactionStatuses.Completed,
      date: txnDate.toISOString(),
      processedDate: txnDate.toISOString(),
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      chargedCurrency: SHEKEL_CURRENCY,
      description: order.description || '',
      memo: `Order: ${order.orderNumber}`,
      identifier: order.orderNumber,
    };

    if (options?.includeRawTransaction) {
      result.rawTransaction = getRawTransaction(order);
    }

    return result;
  });
}

function getPossibleLoginResults(): PossibleLoginResults {
  const urls: PossibleLoginResults = {};
  urls[LoginResults.Success] = [
    `${BASE_URL}/default.aspx`,
    `${BASE_URL}/site/pg/?page=hvr_home`,
    async (options) => {
      const page = options?.page;
      if (!page) return false;
      const logoutLink = await page.$('a[href*="logout"]');
      return !!logoutLink;
    },
  ];
  urls[LoginResults.InvalidPassword] = [
    async (options) => {
      const page = options?.page;
      if (!page) return false;
      const errorMsg = await page.$('#msg3');
      return !!errorMsg;
    },
  ];
  return urls;
}

type HvrCredentials = { id: string; password: string };

class HvrScraper extends BaseScraperWithBrowser<HvrCredentials> {
  getLoginOptions(credentials: HvrCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: [
        { selector: '#tz', value: credentials.id },
        { selector: '#password', value: credentials.password },
      ],
      submitButtonSelector: 'button.btn-hvr',
      possibleResults: getPossibleLoginResults(),
    };
  }

  private async fetchCardTransactions(url: string) {
    await this.navigateTo(url);
    
    // Check if we are on the right page and if the card exists
    const hasHistoryButton = await this.page.$('button[data-target="#collapseTwo"]');
    if (!hasHistoryButton) {
      debug(`No history button found on ${url}, skipping`);
      return [];
    }

    await hasHistoryButton.click();
    await waitUntilElementFound(this.page, '#collapseTwo table.table-striped', true);

    const rawTransactions = await pageEvalAll<ScrapedTransaction[]>(
      this.page,
      '#collapseTwo table.table-striped tr:not(:first-child)',
      [],
      (rows) => {
        return rows.map((row) => {
          const columns = row.querySelectorAll('td');
          if (columns.length >= 4) {
            return {
              date: columns[0].innerText.trim(),
              description: columns[2].innerText.trim(),
              amount: columns[3].innerText.trim(),
            };
          }
          return null;
        }).filter((t): t is ScrapedTransaction => !!t);
      },
    );

    return convertTransactions(rawTransactions, this.options);
  }

  private async fetchOrderList() {
    await this.navigateTo(ORDER_LIST_URL);
    
    const hasOrdersTable = await this.page.$('table#orders');
    if (!hasOrdersTable) {
      debug('No orders table found, skipping');
      return [];
    }

    // Set page size to 100
    const pageSizeSelector = 'select[name="orders_length"]';
    if (await this.page.$(pageSizeSelector)) {
      await this.page.select(pageSizeSelector, '100');
      // Wait for the table to update
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
    }

    const allRawOrders: ScrapedOrder[] = [];
    let hasNextPage = true;

    while (hasNextPage) {
      const rawOrders = await pageEvalAll<ScrapedOrder[]>(
        this.page,
        'table#orders tbody tr',
        [],
        (rows) => {
          return rows.map((row) => {
            const columns = row.querySelectorAll('td');
            if (columns.length >= 7) {
              const dateText = columns[1].innerText.trim().split('\n')[0].split(' ')[0];
              return {
                orderNumber: columns[0].innerText.trim(),
                date: dateText,
                description: columns[2].innerText.trim(),
                amount: columns[5].innerText.trim(),
              };
            }
            return null;
          }).filter((o): o is ScrapedOrder => !!o);
        },
      );

      allRawOrders.push(...rawOrders);

      const nextButtonSelector = '.paginate_button.next:not(.disabled)';
      const nextButton = await this.page.$(nextButtonSelector);
      if (nextButton) {
        const currentInfo = await this.page.$eval('#orders_info', (el) => (el as HTMLElement).innerText);
        await nextButton.click();
        // Wait for the pagination info to change
        await this.page.waitForFunction(
          (oldInfo) => {
            const el = document.querySelector('#orders_info');
            return el && (el as HTMLElement).innerText !== oldInfo;
          },
          {},
          currentInfo,
        );
      } else {
        hasNextPage = false;
      }
    }

    // For orders, date format is DD/MM/YY
    return convertOrders(allRawOrders, { ...this.options, ...{ DATE_FORMAT: 'DD/MM/YY' } });
  }

  async fetchData() {
    const defaultStartMoment = moment().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));

    const shelKevaTxns = await this.fetchCardTransactions(SHEL_KEVA_URL).catch((e) => {
      debug(`Failed to fetch Shel Keva transactions: ${e.message}`);
      return [];
    });
    const teamimTxns = await this.fetchCardTransactions(TEAMIM_URL).catch((e) => {
      debug(`Failed to fetch Teamim transactions: ${e.message}`);
      return [];
    });
    const orderListTxns = await this.fetchOrderList().catch((e) => {
      debug(`Failed to fetch Order List: ${e.message}`);
      return [];
    });

    const allTxns = [...shelKevaTxns, ...teamimTxns, ...orderListTxns];
    
    const filteredTxns = (this.options.outputData?.enableTransactionsFilterByDate ?? true)
      ? filterOldTransactions(allTxns, startMoment, false)
      : allTxns;

    return {
      success: true,
      accounts: [
        {
          accountNumber: 'HVR',
          txns: filteredTxns,
        },
      ],
    };
  }
}

export default HvrScraper;
