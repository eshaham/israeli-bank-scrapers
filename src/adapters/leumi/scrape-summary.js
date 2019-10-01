import { mapAccounts } from './adapterHelpers/accounts';
import { elementPresentOnPage, pageEvalAll } from '../../helpers/elements-interactions';


function scrapeSummaryAdapter() {
  return {
    name: 'scrapeSummary(leumi)',
    validate: (context) => {
      if (!context.hasSessionData('puppeteer.page')) {
        return ['expected puppeteer page to be provided by prior adapter'];
      }

      return [];
    },
    action: async (context) => {
      const page = context.getSessionData('puppeteer.page');

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
        data: {
          leumi: {
            summary: {
              accounts,
            },
          },
        },
      };
    },
  };
}

export default scrapeSummaryAdapter;
