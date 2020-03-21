import loginAdapter from './login';
import scraperTransactionsAdapter from './scrape-transactions';
import scraperPaymentsAdapter from './scrape-payments';
import * as visaCalHelpers from './adapter-helpers';
import * as visaCalDefinitions from './definitions';

const visaCalAdapters = {
  scraperTransactionsAdapter, scraperPaymentsAdapter, loginAdapter
}

export { visaCalAdapters, visaCalHelpers, visaCalDefinitions };
