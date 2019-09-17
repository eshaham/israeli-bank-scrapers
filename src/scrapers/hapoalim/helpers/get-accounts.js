import { fetchGetWithinPage } from '../../../helpers/fetch';
import { BASE_URL } from '../definitions';

export default async function getAccounts(page) {
  const accountDataUrl = `${BASE_URL}/ServerServices/general/accounts`;
  const accountsInfo = await fetchGetWithinPage(page, accountDataUrl);

  const accounts = accountsInfo.map(accountInfo => ({
    isClosed: accountInfo.accountClosingReasonCode !== 0,
    bankNumber: accountInfo.bankNumber,
    branchNumber: accountInfo.branchNumber,
    accountNumber: accountInfo.accountNumber,
    accountToken: `${accountInfo.bankNumber}-${accountInfo.branchNumber}-${accountInfo.accountNumber}`,
  }));

  return accounts;
}
