import fs from 'fs';
import path from 'path';
import moment from 'moment';
import json2csv from 'json2csv';

let testsConfig = null;
let configurationLoaded = false;

const MISSING_ERROR_MESSAGE = 'Missing environment test configuration. To troubleshot this issue open CONTRIBUTING.md file and read section "F.A.Q regarding the tests".';

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
    throw new Error(`failed to parse environment variable 'TESTS_CONFIG' with error '${e.message}'`);
  }

  try {
    // eslint-disable-next-line global-require
    testsConfig = require('./.tests-config').default;
    return process.env;
  } catch (e) {
    throw new Error(MISSING_ERROR_MESSAGE);
  }
}

export function maybeTestCompanyAPI(scraperId, category) {
  if (!configurationLoaded) {
    getTestsConfig();
  }
  return testsConfig && !!testsConfig.companyAPI[category] &&
  testsConfig.credentials[scraperId] ? test : test.skip;
}

export function extendAsyncTimeout(timeout = 120000) {
  jest.setTimeout(timeout);
}

function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
  const { sep } = path;
  const initDir = path.isAbsolute(targetDir) ? sep : '';
  const baseDir = isRelativeToScript ? __dirname : '.';

  return targetDir.split(sep).reduce((parentDir, childDir) => {
    const curDir = path.resolve(baseDir, parentDir, childDir);
    try {
      fs.mkdirSync(curDir);
    } catch (err) {
      if (err.code === 'EEXIST') { // curDir already exists!
        return curDir;
      }

      // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
      if (err.code === 'ENOENT') { // Throw the original parentDir error on curDir `ENOENT` failure.
        throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
      }

      const caughtErr = ['EACCES', 'EPERM', 'EISDIR'].indexOf(err.code) > -1;
      if (!caughtErr || (caughtErr && curDir === path.resolve(targetDir))) {
        throw err; // Throw if it's just the last created dir.
      }
    }

    return curDir;
  }, initDir);
}

export function getDistFolder(subFolder) {
  const config = getTestsConfig();

  if (!config.companyAPI ||
    !config.companyAPI.dist ||
    !fs.existsSync(config.companyAPI.dist)
  ) {
    return '';
  }

  const result = `${path.resolve(config.companyAPI.dist, subFolder)}`;

  if (!fs.existsSync(result)) {
    mkDirByPathSync(result);
  }

  return result;
}

export function getUniqueDistFolder(subFolder) {
  const uniqueFolder = path.join(subFolder, moment().format('YYYYMMDD-HHmmss'));
  return getDistFolder(uniqueFolder);
}

export function saveAccountsAsCSV(distFolder, fileName, accounts) {
  if (!distFolder) {
    console.error('cannot save accounts as csv, dist folder is required');
    return;
  }

  let data = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];

    data = [
      ...data,
      ...account.txns.map((txn) => {
        return {
          account: account.accountNumber,
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
  const filePath = `${path.join(distFolder, fileName)}.csv`;
  fs.writeFileSync(filePath, csv);
  console.log(`created file '${filePath}'`);
}
