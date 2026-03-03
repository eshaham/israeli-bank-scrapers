import moment from 'moment';

import { getDebug } from '../../Common/Debug';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { getRawTransaction } from '../../Common/Transactions';
import { CompanyTypes } from '../../Definitions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { GenericBankScraper } from '../Base/GenericBankScraper';
import { type ScraperOptions, type ScraperScrapingResult } from '../Base/Interface';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';
import { BEHATSDAA_CONFIG } from './BehatsdaaLoginConfig';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Behatsdaa];

const LOG = getDebug('behatsdaa');

interface ScraperSpecificCredentials {
  id: string;
  password: string;
}

interface Variant {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string; // ISO timestamp with no timezone
  tTransactionID: string;
}

interface PurchaseHistoryResponse {
  data?: {
    errorDescription?: string;
    memberId: string;
    variants: Variant[];
  };
  errorDescription?: string;
}

function variantToTransaction(variant: Variant, options?: ScraperOptions): Transaction {
  // The price is positive, make it negative as it's an expense
  const originalAmount = -variant.customerPrice;
  const result: Transaction = {
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

  if (options?.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(variant);
  }

  return result;
}

class BehatsdaaScraper extends GenericBankScraper<ScraperSpecificCredentials> {
  constructor(options: ScraperOptions) {
    super(options, BEHATSDAA_CONFIG);
  }

  public async fetchData(): Promise<ScraperScrapingResult> {
    const token = await this.page.evaluate(() => window.localStorage.getItem('userToken'));
    if (!token) {
      LOG.info('Token not found in local storage');
      return { success: false, errorMessage: 'TokenNotFound' };
    }
    const res = await this.fetchWithToken(token);
    LOG.info('Data fetched');
    return this.buildAccountResult(res ?? {});
  }

  private async fetchWithToken(token: string): Promise<PurchaseHistoryResponse | null> {
    const body = {
      FromDate: moment(this.options.startDate).format('YYYY-MM-DDTHH:mm:ss'),
      ToDate: moment().format('YYYY-MM-DDTHH:mm:ss'),
      BenefitStatusId: null,
    };
    LOG.info('Fetching data');
    return fetchPostWithinPage<PurchaseHistoryResponse>(this.page, CFG.api.purchaseHistory, {
      data: body,
      extraHeaders: {
        authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        organizationid: CFG.auth.organizationId,
      },
    });
  }

  private buildAccountResult(res: NonNullable<PurchaseHistoryResponse>): ScraperScrapingResult {
    if (res.errorDescription || res.data?.errorDescription) {
      LOG.info('Error fetching data: %s', res.errorDescription ?? res.data?.errorDescription);
      return { success: false, errorMessage: res.errorDescription };
    }
    if (!res.data) {
      LOG.info('No data found');
      return { success: false, errorMessage: 'NoData' };
    }
    LOG.info('Data fetched successfully');
    return {
      success: true,
      accounts: [
        {
          accountNumber: res.data.memberId,
          txns: res.data.variants.map(variant => variantToTransaction(variant, this.options)),
        },
      ],
    };
  }
}

export default BehatsdaaScraper;
