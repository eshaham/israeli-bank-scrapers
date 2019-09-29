import createGeneralError from '../../helpers/errors';
import { mapAccounts } from './helpers/accounts';
import { elementPresentOnPage, pageEvalAll } from '../../helpers/elements-interactions';


async function scrapeSummary(page) {
  try {
    const accounts = await mapAccounts(page, async (page, { accountName }) => {
      const balance = await pageEvalAll(page, '#WorkSpaceBox #ctlActivityTable tr:nth-child(2) td:not(.HiddenColumn)', [], (tds) => {
        return tds[tds.length - 1].innerText;
      });

      const hasTodayTable = await elementPresentOnPage(page, '#WorkSpaceBox #ctlTodayActivityTableUpper');

      const pendingBalance = hasTodayTable ? await pageEvalAll(page, '#WorkSpaceBox #ctlTodayActivityTableUpper tr:nth-child(2) td:not(.HiddenColumn)', [], (tds) => {
        return tds[tds.length - 1].innerText;
      }) : balance;

      return {
        accountNumber: accountName,
        summary: {
          balance,
          pendingBalance,
        },
      };
    });

    return {
      success: true,
      accounts,
    };
  } catch (error) {
    return createGeneralError();
  }
}

export default scrapeSummary;
