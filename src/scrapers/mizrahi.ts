import moment from 'moment';
import { type Frame, type HTTPRequest, type Page } from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import {
  pageEvalAll,
  waitUntilElementDisappear,
  waitUntilElementFound,
  waitUntilIframeFound,
} from '../helpers/elements-interactions';
import { fetchPostWithinPage } from '../helpers/fetch';
import { waitForUrl } from '../helpers/navigation';
import { type Transaction, TransactionStatuses, TransactionTypes, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type PossibleLoginResults } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { getDebug } from '../helpers/debug';
import { getRawTransaction } from '../helpers/transactions';
import { type ScraperOptions } from './interface';

const debug = getDebug('mizrahi');

interface ScrapedTransaction {
  RecTypeSpecified: boolean;
  MC02PeulaTaaEZ: string;
  MC02SchumEZ: number;
  MC02AsmahtaMekoritEZ: string;
  MC02TnuaTeurEZ: string;
  IsTodayTransaction: boolean;
  MC02ErehTaaEZ: string;
  MC02ShowDetailsEZ?: string;
  MC02KodGoremEZ: any;
  MC02SugTnuaKaspitEZ: any;
  MC02AgidEZ: any;
  MC02SeifMaralEZ: any;
  MC02NoseMaralEZ: any;
  TransactionNumber: any;
}

interface ScrapedTransactionsResult {
  header: {
    success: boolean;
    messages: { text: string }[];
  };
  body: {
    fields: {
      Yitra: string;
    };
    table: {
      rows: ScrapedTransaction[];
    };
  };
}

type MoreDetailsResponse = {
  body: {
    fields: [
      [
        {
          Records: [
            {
              Fields: Array<{
                Label: string;
                Value: string;
              }>;
            },
          ];
        },
      ],
    ];
  };
};

type MoreDetails = {
  entries: Record<string, string>;
  memo: string | undefined;
};

const BASE_WEBSITE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_WEBSITE_URL}/login/index.html#/auth-page-he`;
const BASE_APP_URL = 'https://mto.mizrahi-tefahot.co.il';
const AFTER_LOGIN_BASE_URL = /https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/;
const OSH_PAGE = '/osh/legacy/legacy-Osh-Main';
const TRANSACTIONS_PAGE = '/osh/legacy/root-main-osh-p428New';
const TRANSACTIONS_REQUEST_URLS = [
  `${BASE_APP_URL}/OnlinePilot/api/SkyOSH/get428Index`,
  `${BASE_APP_URL}/Online/api/SkyOSH/get428Index`,
];
const PENDING_TRANSACTIONS_PAGE = '/osh/legacy/legacy-Osh-p420';
const PENDING_TRANSACTIONS_IFRAME = 'p420.aspx';
const MORE_DETAILS_URL = `${BASE_APP_URL}/Online/api/OSH/getMaherBerurimSMF`;
const CHANGE_PASSWORD_URL = /https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/index\.html#\/change-pass/;
const DATE_FORMAT = 'DD/MM/YYYY';
const MAX_ROWS_PER_REQUEST = 10000000000;

const usernameSelector = '#userNumberDesktopHeb';
const passwordSelector = '#passwordDesktopHeb';
const submitButtonSelector = 'button.btn.btn-primary';
const invalidPasswordSelector = 'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';
const afterLoginSelector = '#dropdownBasic';
const loginSpinnerSelector = 'div.ngx-overlay.loading-foreground';
const accountDropDownItemSelector = '#AccountPicker .item';
const pendingTrxIdentifierId = '#ctl00_ContentPlaceHolder2_panel1';
const checkingAccountTabHebrewName = 'עובר ושב';
const checkingAccountTabEnglishName = 'Checking Account';
const genericDescriptions = ['העברת יומן לבנק זר מסניף זר'];

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    { selector: usernameSelector, value: credentials.username },
    { selector: passwordSelector, value: credentials.password },
  ];
}

async function isLoggedIn(options: { page?: Page | undefined } | undefined) {
  if (!options?.page) {
    return false;
  }
  const oshXPath = `//a//span[contains(., "${checkingAccountTabHebrewName}") or contains(., "${checkingAccountTabEnglishName}")]`;
  const oshTab = await options.page.$$(`xpath${oshXPath}`);
  return oshTab.length > 0;
}

function getPossibleLoginResults(page: Page): PossibleLoginResults {
  return {
    [LoginResults.Success]: [AFTER_LOGIN_BASE_URL, isLoggedIn],
    [LoginResults.InvalidPassword]: [async () => !!(await page.$(invalidPasswordSelector))],
    [LoginResults.ChangePassword]: [CHANGE_PASSWORD_URL],
  };
}

function getStartMoment(optionsStartDate: Date) {
  const defaultStartMoment = moment().subtract(1, 'years');
  const startDate = optionsStartDate || defaultStartMoment.toDate();
  return moment.max(defaultStartMoment, moment(startDate));
}

async function getExtraTransactionDetails(
  page: Page,
  item: ScrapedTransaction,
  apiHeaders: Record<string, string>,
): Promise<MoreDetails> {
  try {
    debug('getExtraTransactionDetails for item:', item);
    if (item.MC02ShowDetailsEZ === '1') {
      const tarPeula = moment(item.MC02PeulaTaaEZ);
      const tarErech = moment(item.MC02ErehTaaEZ);

      const params = {
        inKodGorem: item.MC02KodGoremEZ,
        inAsmachta: item.MC02AsmahtaMekoritEZ,
        inSchum: item.MC02SchumEZ,
        inNakvanit: item.MC02KodGoremEZ,
        inSugTnua: item.MC02SugTnuaKaspitEZ,
        inAgid: item.MC02AgidEZ,
        inTarPeulaFormatted: tarPeula.format(DATE_FORMAT),
        inTarErechFormatted: (tarErech.year() > 2000 ? tarErech : tarPeula).format(DATE_FORMAT),
        inKodNose: item.MC02SeifMaralEZ,
        inKodTatNose: item.MC02NoseMaralEZ,
        inTransactionNumber: item.TransactionNumber,
      };

      const response = await fetchPostWithinPage<MoreDetailsResponse>(page, MORE_DETAILS_URL, params, apiHeaders);
      const details = response?.body.fields?.[0]?.[0]?.Records?.[0].Fields;
      debug('fetch details for', params, 'details:', details);
      if (Array.isArray(details) && details.length > 0) {
        const entries = details.map(record => [record.Label.trim(), record.Value.trim()]);
        return {
          entries: Object.fromEntries(entries),
          memo: entries
            .filter(([label]) => ['שם', 'מהות', 'חשבון'].some(key => label.startsWith(key)))
            .map(([label, value]) => `${label} ${value}`)
            .join(', '),
        };
      }
    }
  } catch (error) {
    debug('Error fetching extra transaction details:', error);
  }

  return {
    entries: {},
    memo: undefined,
  };
}

function createDataFromRequest(request: HTTPRequest, optionsStartDate: Date) {
  const data = JSON.parse(request.postData() || '{}');

  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = moment().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;

  return data;
}

function createHeadersFromRequest(request: HTTPRequest) {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type'],
  };
}

function getTransactionIdentifier(row: ScrapedTransaction): string | number | undefined {
  if (!row.MC02AsmahtaMekoritEZ) {
    return undefined;
  }
  if (row.TransactionNumber && String(row.TransactionNumber) !== '1') {
    return `${row.MC02AsmahtaMekoritEZ}-${row.TransactionNumber}`;
  }
  return parseInt(row.MC02AsmahtaMekoritEZ, 10);
}

async function convertTransactions(
  txns: ScrapedTransaction[],
  getMoreDetails: (row: ScrapedTransaction) => Promise<MoreDetails>,
  pendingIfTodayTransaction: boolean = false,
  options?: ScraperOptions,
): Promise<Transaction[]> {
  return Promise.all(
    txns.map(async row => {
      const moreDetails = await getMoreDetails(row);

      const txnDate = moment(row.MC02PeulaTaaEZ, moment.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();

      const result: Transaction = {
        type: TransactionTypes.Normal,
        identifier: getTransactionIdentifier(row),
        date: txnDate,
        processedDate: txnDate,
        originalAmount: row.MC02SchumEZ,
        originalCurrency: SHEKEL_CURRENCY,
        chargedAmount: row.MC02SchumEZ,
        description: row.MC02TnuaTeurEZ,
        memo: moreDetails?.memo,
        status:
          pendingIfTodayTransaction && row.IsTodayTransaction
            ? TransactionStatuses.Pending
            : TransactionStatuses.Completed,
      };

      if (options?.includeRawTransaction) {
        result.rawTransaction = getRawTransaction({
          ...row,
          additionalInformation: moreDetails.entries,
        });
      }

      return result;
    }),
  );
}

async function extractPendingTransactions(page: Frame): Promise<Transaction[]> {
  const pendingTxn = await pageEvalAll(page, 'tr.rgRow, tr.rgAltRow', [], trs => {
    return trs.map(tr => Array.from(tr.querySelectorAll('td'), td => td.textContent || ''));
  });

  return pendingTxn
    .map(([dateStr, description, incomeAmountStr, amountStr]) => ({
      date: moment(dateStr, 'DD/MM/YY').toISOString(),
      amount: parseFloat(amountStr.replaceAll(',', '')),
      description,
      incomeAmountStr, // TODO: handle incomeAmountStr once we know the sign of it
    }))
    .filter(txn => txn.date)
    .map(({ date, description, amount }) => ({
      type: TransactionTypes.Normal,
      date,
      processedDate: date,
      originalAmount: amount,
      originalCurrency: SHEKEL_CURRENCY,
      chargedAmount: amount,
      description,
      status: TransactionStatuses.Pending,
    }));
}

async function postLogin(page: Page) {
  await Promise.race([
    waitUntilElementFound(page, afterLoginSelector),
    waitUntilElementFound(page, invalidPasswordSelector),
    waitForUrl(page, CHANGE_PASSWORD_URL),
  ]);
}

type ScraperSpecificCredentials = { username: string; password: string };

class MizrahiScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector,
      checkReadiness: async () => waitUntilElementDisappear(this.page, loginSpinnerSelector),
      postAction: async () => postLogin(this.page),
      possibleResults: getPossibleLoginResults(this.page),
    };
  }

  async fetchData() {
    await this.page.$eval('#dropdownBasic, .item', el => (el as HTMLElement).click());

    const numOfAccounts = (await this.page.$$(accountDropDownItemSelector)).length;

    try {
      const results: TransactionsAccount[] = [];

      for (let i = 0; i < numOfAccounts; i += 1) {
        if (i > 0) {
          await this.page.$eval('#dropdownBasic, .item', el => (el as HTMLElement).click());
        }

        await this.page.$eval(`${accountDropDownItemSelector}:nth-child(${i + 1})`, el => (el as HTMLElement).click());
        results.push(await this.fetchAccount());
      }

      return {
        success: true,
        accounts: results,
      };
    } catch (e) {
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: (e as Error).message,
      };
    }
  }

  private async getPendingTransactions(): Promise<Transaction[]> {
    await this.page.$eval(`a[href*="${PENDING_TRANSACTIONS_PAGE}"]`, el => (el as HTMLElement).click());
    const frame = await waitUntilIframeFound(this.page, f => f.url().includes(PENDING_TRANSACTIONS_IFRAME));
    const isPending = await waitUntilElementFound(frame, pendingTrxIdentifierId)
      .then(() => true)
      .catch(() => false);
    if (!isPending) {
      return [];
    }

    const pendingTxn = await extractPendingTransactions(frame);
    return pendingTxn;
  }

  private async fetchAccount() {
    await this.page.waitForSelector(`a[href*="${OSH_PAGE}"]`);
    await this.page.$eval(`a[href*="${OSH_PAGE}"]`, el => (el as HTMLElement).click());
    await waitUntilElementFound(this.page, `a[href*="${TRANSACTIONS_PAGE}"]`);
    await this.page.$eval(`a[href*="${TRANSACTIONS_PAGE}"]`, el => (el as HTMLElement).click());

    const accountNumberElement = await this.page.$('#dropdownBasic b span');
    const accountNumberHandle = await accountNumberElement?.getProperty('title');
    const accountNumber = (await accountNumberHandle?.jsonValue()) as string;
    if (!accountNumber) {
      throw new Error('Account number not found');
    }

    const [response, apiHeaders] = await Promise.any(
      TRANSACTIONS_REQUEST_URLS.map(async url => {
        const request = await this.page.waitForRequest(url);
        const data = createDataFromRequest(request, this.options.startDate);
        const headers = createHeadersFromRequest(request);

        return [await fetchPostWithinPage<ScrapedTransactionsResult>(this.page, url, data, headers), headers] as const;
      }),
    );

    if (!response || response.header.success === false) {
      throw new Error(
        `Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`,
      );
    }

    const relevantRows = response.body.table.rows.filter(row => row.RecTypeSpecified);
    const oshTxn = await convertTransactions(
      relevantRows,
      this.options.additionalTransactionInformation
        ? row => getExtraTransactionDetails(this.page, row, apiHeaders)
        : () => Promise.resolve({ entries: {}, memo: undefined }),
      this.options.optInFeatures?.includes('mizrahi:pendingIfTodayTransaction'),
      this.options,
    );

    oshTxn
      .filter(txn => this.shouldMarkAsPending(txn))
      .forEach(txn => {
        txn.status = TransactionStatuses.Pending;
      });

    // workaround for a bug which the bank's API returns transactions before the requested start date
    const startMoment = getStartMoment(this.options.startDate);
    const oshTxnAfterStartDate = oshTxn.filter(txn => moment(txn.date).isSameOrAfter(startMoment));

    const pendingTxn = await this.getPendingTransactions();
    const allTxn = oshTxnAfterStartDate.concat(pendingTxn);

    return {
      accountNumber,
      txns: allTxn,
      balance: +response.body.fields?.Yitra,
    };
  }

  private shouldMarkAsPending(txn: Transaction): boolean {
    if (this.options.optInFeatures?.includes('mizrahi:pendingIfNoIdentifier') && !txn.identifier) {
      debug(`Marking transaction '${txn.description}' as pending due to no identifier.`);
      return true;
    }

    if (
      this.options.optInFeatures?.includes('mizrahi:pendingIfHasGenericDescription') &&
      genericDescriptions.includes(txn.description)
    ) {
      debug(`Marking transaction '${txn.description}' as pending due to generic description.`);
      return true;
    }

    return false;
  }
}

export default MizrahiScraper;
