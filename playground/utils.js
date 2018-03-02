import fs from 'fs';
import path from 'path';
import json2csv from 'json2csv';
import moment from 'moment';

const writeFileAsync = promisify(fs.writeFile);
const makeDirAsync = promisify(fs.mkdir);
const accessAsync = promisify(fs.access);

export function promisify(fn) {
  return (...args) =>
  {
    return new Promise((resolve, reject) =>
    {
      const fnArgs = [...args, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      }];

      try {
        fn.apply(this, fnArgs);
      }catch(err)
      {
        reject(err);
      }
    })
  }
}

async function verifyFolder(filePath) {
  const folder = path.dirname(filePath);

  try {
    await accessAsync(folder);
  }catch(err)
  {
    await makeDirAsync(folder);
  }
}


export async function exportAccountData(scraperId, account, saveLocation) {
  const txns = account.txns.map(txn =>
    ({
      type: txn.type,
      identifier: txn.identifier,
      date: moment(txn.date).format('YYYY-MM-DD'),
      processedDate: moment(txn.processedDate).format('YYYY-MM-DD'),
      originalAmount: txn.originalAmount,
      originalCurrency: txn.originalCurrency,
      chargedAmount: txn.chargedAmount,
      description: txn.description,
      memo: txn.memo,
    }));
  const fields = ['type', 'identifier', 'date', 'processedDate', 'originalAmount', 'originalCurrency', 'chargedAmount', 'description', 'memo'];
  const csv = json2csv({ data: txns, fields, withBOM: true });
  await writeFile(`${saveLocation}/${scraperId} (${account.accountNumber}).csv`, csv);
}

async function writeFile(filePath, data, options) {
  await verifyFolder(filePath);
  return writeFileAsync(filePath, data, options);
}
