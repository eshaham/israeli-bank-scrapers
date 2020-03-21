import { fetchGetWithinPage } from '../../../helpers/fetch';
import { BASE_URL } from '../definitions';

export async function accounts(page) {
  const accountDataUrl = `${BASE_URL}/ServerServices/general/accounts`;
  const accountsInfo = await fetchGetWithinPage(page, accountDataUrl);

  const accounts = accountsInfo.map((accountInfo) => ({
    isClosed: accountInfo.accountClosingReasonCode !== 0,
    bankNumber: accountInfo.bankNumber,
    branchNumber: accountInfo.branchNumber,
    accountNumber: accountInfo.accountNumber,
    accountToken: `${accountInfo.bankNumber}-${accountInfo.branchNumber}-${accountInfo.accountNumber}`,
  }));

  return accounts;
}


export async function getActiveAccountsInfo(page) {
  const allAccountsInfo = await accounts(page);
  return allAccountsInfo.filter((item) => !item.isClosed);
}
