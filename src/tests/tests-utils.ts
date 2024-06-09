import fs from 'fs';
import * as json2csv from 'json2csv';
import moment from 'moment';
import path from 'path';
import { TransactionsAccount } from '../transactions';

let testsConfig: Record<string, any>;
let configurationLoaded = false;

const MISSING_ERROR_MESSAGE = 'Missing test environment configuration. To troubleshoot this issue open CONTRIBUTING.md file and read the "F.A.Q regarding the tests" section.';

export function getTestsConfig() {
  if (configurationLoaded) {
    if (!testsConfig) {
      throw new Error(MISSING_ERROR_MESSAGE);
    }

    return testsConfig;
  }

  configurationLoaded = true;

  try {
    const environmentConfig = process.env.TESTS_CONFIG;
    if (environmentConfig) {
      testsConfig = JSON.parse(environmentConfig);
      return testsConfig;
    }
  } catch (e) {
    throw new Error(`failed to parse environment variable 'TESTS_CONFIG' with error '${(e as Error).message}'`);
  }

  try {
    const configPath = path.join(__dirname, '.tests-config.js');
    testsConfig = require(configPath);
    return testsConfig;
  } catch (e) {
    console.error(e);
    throw new Error(MISSING_ERROR_MESSAGE);
  }
}

export function maybeTestCompanyAPI(scraperId: string, filter?: (config: any) => boolean) {
  if (!configurationLoaded) {
    getTestsConfig();
  }
  return testsConfig && testsConfig.companyAPI.enabled &&
  testsConfig.credentials[scraperId] &&
  (!filter || filter(testsConfig)) ? test : test.skip;
}

export function extendAsyncTimeout(timeout = 120000) {
  jest.setTimeout(timeout);
}

export function exportTransactions(fileName: string, accounts: TransactionsAccount[]) {
  const config = getTestsConfig();

  if (!config.companyAPI.enabled ||
    !config.companyAPI.excelFilesDist ||
    !fs.existsSync(config.companyAPI.excelFilesDist)) {
    return;
  }

  let data: any = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];

    data = [
      ...data,
      ...account.txns.map((txn) => {
        return {
          account: account.accountNumber,
          balance: `account balance: ${account.balance}`,
          ...txn,
          date: moment(txn.date).format('DD/MM/YYYY'),
          processedDate: moment(txn.processedDate).format('DD/MM/YYYY'),
        };
      })];
  }

  if (data.length === 0) {
    data = [
      {
        comment: 'no transaction found for requested time frame',
      },
    ];
  }

  const csv = json2csv.parse(data, { withBOM: true });
  const filePath = `${path.join(config.companyAPI.excelFilesDist, fileName)}.csv`;
  fs.writeFileSync(filePath, csv);
}
