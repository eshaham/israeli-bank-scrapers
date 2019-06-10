import moment from 'moment';
import fs from 'fs';
import {
  getRestContext,
  DATE_FORMAT,
  fetchPoalimXSRFWithinPage,
  fetchPoalimXSRFWithinPageGet,
  convertTransactions,
} from '../hapoalim';
import { fetchGetWithinPage } from '../../helpers/fetch';
import { addMonths } from '../../helpers/dates';

export async function fetchAccountData(page, options) {
  const restContext = await getRestContext(page);
  const realBaseUrl = 'https://biz2.bankhapoalim.co.il';
  const apiSiteUrl = `${realBaseUrl}/${restContext}`;
  const accountDataUrl = `${apiSiteUrl}/general/accounts`;
  const accountsInfo = await fetchGetWithinPage(page, accountDataUrl);

  const defaultStartMoment = moment().subtract(1, 'years').add(1, 'day');
  const startDate = options.startDate || defaultStartMoment.toDate();
  const startMoment = moment.max(defaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  const accounts = [];
  for (let accountIndex = 0; accountIndex < accountsInfo.length; accountIndex += 1) {
    const accountNumber = `${accountsInfo[accountIndex].bankNumber}-${accountsInfo[accountIndex].branchNumber}-${accountsInfo[accountIndex].accountNumber}`;

    const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=200&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&sortCode=1`;
    const txnsResult = await fetchPoalimXSRFWithinPage(page, txnsUrl, '/current-account/transactions');

    let txns = [];
    let checkingShekelsBalance = 0;
    if (txnsResult) {
      checkingShekelsBalance = txnsResult.transactions[0].currentBalance;

      const date = new Date();
      const dateString = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
        .toISOString()
        .split('T')[0];
      fs.writeFile(`./old_data/POALIM_original_checking_bank_dump_${dateString}_${accountIndex}.json`, JSON.stringify(txnsResult.transactions), 'utf8', () => {
        console.log('done dumping original checking dump file');
      });

      txns = convertTransactions(txnsResult.transactions);
    }

    let checkingDollarsBalance = 0;
    let checkingDollarsBalanceInShekels = 0;
    let checkingEuroBalance = 0;
    let checkingEuroBalanceInShekels = 0;

    const forigenTxnsUrl = `${apiSiteUrl}/foreign-currency/transactions?accountId=${accountNumber}&type=business&view=details&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&currencyCodeList=19,100&detailedAccountTypeCodeList=142&lang=he`;
    const forigenTxnsResult = await fetchPoalimXSRFWithinPageGet(page, forigenTxnsUrl, '/foreign-currency/transactions');

    const dollarsBalanceUrl = `${apiSiteUrl}/foreign-currency/transactions?accountId=${accountNumber}&view=graph&detailedAccountTypeCode=142&currencyCode=19&lang=he`;
    const dollarsBalanceResult = await fetchPoalimXSRFWithinPageGet(page, dollarsBalanceUrl, '/foreign-currency/transactions');
    const eurosBalanceUrl = `${apiSiteUrl}/foreign-currency/transactions?accountId=${accountNumber}&view=graph&detailedAccountTypeCode=142&currencyCode=100&lang=he`;
    const eurosBalanceResult = await fetchPoalimXSRFWithinPageGet(page, eurosBalanceUrl, '/foreign-currency/transactions');

    checkingDollarsBalance = dollarsBalanceResult.graphData[dollarsBalanceResult.graphData.length - 1].currencyAccountBalance;
    checkingEuroBalance = eurosBalanceResult.graphData[eurosBalanceResult.graphData.length - 1].currencyAccountBalance;

    const transactionBalanceUrl = `${apiSiteUrl}/foreign-currency/transactions?accountId=${accountNumber}&type=business&lang=he`;
    const transactionBalanceResult = await fetchPoalimXSRFWithinPageGet(page, transactionBalanceUrl, '/foreign-currency/transactions');

    for (
      let foreignAccountbalancesIndex = 0;
      foreignAccountbalancesIndex < transactionBalanceResult.balancesAndLimitsDataList.length;
      foreignAccountbalancesIndex += 1) {
      switch (transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].currencyCode) {
        case 19:
          checkingDollarsBalance =
                transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].currentBalance;

          for (
            let foreignAccountShekelBalancesIndex = 0;
            foreignAccountShekelBalancesIndex < transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance.length;
            foreignAccountShekelBalancesIndex += 1) {
            if (transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance[foreignAccountShekelBalancesIndex].revaluationCurrencyCode == 1) {
              checkingDollarsBalanceInShekels =
                      transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance[foreignAccountShekelBalancesIndex].revaluatedCurrentBalance;
            }
          }
          break;
        case 100:
          checkingEuroBalance =
                transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].currentBalance;

          for (
            let foreignAccountShekelBalancesIndex = 0;
            foreignAccountShekelBalancesIndex < transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance.length;
            foreignAccountShekelBalancesIndex += 1) {
            if (transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance[foreignAccountShekelBalancesIndex].revaluationCurrencyCode == 1) {
              checkingEuroBalanceInShekels =
                    transactionBalanceResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].revaluatedCurrentBalance[foreignAccountShekelBalancesIndex].revaluatedCurrentBalance;
            }
          }
          break;

        default:
          break;
      }
    }

    const checkingDollarTransactions = [];
    const checkingEuroTransactions = [];
    for (
      let foreignAccountbalancesIndex = 0;
      foreignAccountbalancesIndex < forigenTxnsResult.balancesAndLimitsDataList.length;
      foreignAccountbalancesIndex += 1) {
      switch (forigenTxnsResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].currencyCode) {
        case 19:
          checkingDollarTransactions.push(forigenTxnsResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].transactions);
          break;
        case 100:
          checkingEuroTransactions.push(forigenTxnsResult.balancesAndLimitsDataList[foreignAccountbalancesIndex].transactions);
          break;

        default:
          break;
      }
    }


    const creditcardMonths = [];
    const creditCardTxnsUrl = `${apiSiteUrl}/plastic-cards/transactions?accountId=${accountNumber}&type=current`;
    const creditCardTxnsResult = await fetchPoalimXSRFWithinPageGet(page, creditCardTxnsUrl, '/plastic-cards/transactions');

    if (creditCardTxnsResult) {
      creditcardMonths.push(creditCardTxnsResult);
    }

    for (
      let currentMonth = 0;
      currentMonth <= 6;
      currentMonth += 1) {
      const monthDate = addMonths(new Date(), -currentMonth);

      const dateString = moment(monthDate).format('YYYYMM');

      const creditCardTxnsUrl = `${apiSiteUrl}/plastic-cards/transactions?accountId=${accountNumber}&type=previous&statementDate=${dateString}00`;
      const previousCreditCardTxnsResult = await fetchPoalimXSRFWithinPageGet(page, creditCardTxnsUrl, '/plastic-cards/transactions');

      creditcardMonths.push(previousCreditCardTxnsResult);
    }

    const creditCardShekelsTransactions = [];
    const creditCardDollarsTransactions = [];
    const creditCardEuroTransactions = [];

    const date = new Date();
    const dateString = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
    fs.writeFile(`./old_data/POALIM_creditbard_bank_dump_${dateString}_${accountIndex}.json`, JSON.stringify(creditcardMonths), 'utf8', () => {
      console.log('done dumping creditcard dump file');
    });

    creditcardMonths.forEach((creditcardMonth) => {
      if (!creditcardMonth) return;
      const { vauchers } = creditcardMonth.plasticCardData[0];

      for (const creditCardVaucherIndex in vauchers) {
        if (vauchers.hasOwnProperty(creditCardVaucherIndex)) {
          const beforeShekels = vauchers[creditCardVaucherIndex].vauchersByCurrencyCodes['0'];
          const afterShekels = (typeof beforeShekels !== 'undefined' && beforeShekels.hasOwnProperty('vaucherDetails')) ?
            beforeShekels.vaucherDetails[Object.keys(beforeShekels.vaucherDetails)[0]] : undefined;

          const beforeDollars = vauchers[creditCardVaucherIndex].vauchersByCurrencyCodes['19'];
          const afterDollars = (typeof beforeDollars !== 'undefined' && beforeDollars.hasOwnProperty('vaucherDetails')) ?
            beforeDollars.vaucherDetails[Object.keys(beforeDollars.vaucherDetails)[0]] : undefined;

          const beforeEuros = vauchers[creditCardVaucherIndex].vauchersByCurrencyCodes['100'];
          const afterEuros = (typeof beforeEuros !== 'undefined' && beforeEuros.hasOwnProperty('vaucherDetails')) ?
            beforeEuros.vaucherDetails[Object.keys(beforeEuros.vaucherDetails)[0]] : undefined;

          if (afterShekels) {
            for (
              let creditCardTransactionsIndex = 0;
              creditCardTransactionsIndex < afterShekels.length;
              creditCardTransactionsIndex += 1) {
              const transaction = {
                amount: afterShekels[creditCardTransactionsIndex].debitAmount,
                currency: afterShekels[creditCardTransactionsIndex].debitCurrencyCode,
                date: afterShekels[creditCardTransactionsIndex].eventDate,
                business: (afterShekels[creditCardTransactionsIndex].clientBusinessName) ? afterShekels[creditCardTransactionsIndex].clientBusinessName.substring(
                  afterShekels[creditCardTransactionsIndex].clientBusinessName.indexOf('~') + 1,
                ) : '',
                eventId: afterShekels[creditCardTransactionsIndex].originalSystemEventId,
                reference: afterShekels[creditCardTransactionsIndex].referenceNumber,
                debitDate: afterShekels[creditCardTransactionsIndex].debitDate,
                originalAmount: (afterShekels[creditCardTransactionsIndex].originalAmount !=
                      afterShekels[creditCardTransactionsIndex].debitAmount) ? afterShekels[creditCardTransactionsIndex].originalAmount : undefined,
                originalCurrency: (afterShekels[creditCardTransactionsIndex].originalAmount !=
                      afterShekels[creditCardTransactionsIndex].debitAmount) ? afterShekels[creditCardTransactionsIndex].eventCurrencyDescription : undefined,
              };
              creditCardShekelsTransactions.push(transaction);
            }
          }

          if (afterDollars) {
            for (
              let creditCardTransactionsIndex = 0;
              creditCardTransactionsIndex < afterDollars.length;
              creditCardTransactionsIndex += 1) {
              const transaction = {
                amount: afterDollars[creditCardTransactionsIndex].debitAmount,
                currency: afterDollars[creditCardTransactionsIndex].debitCurrencyCode,
                date: afterDollars[creditCardTransactionsIndex].eventDate,
                business: (afterDollars[creditCardTransactionsIndex].clientBusinessName) ? afterDollars[creditCardTransactionsIndex].clientBusinessName.substring(
                  afterDollars[creditCardTransactionsIndex].clientBusinessName.indexOf('~') + 1,
                ) : '',
                eventId: afterDollars[creditCardTransactionsIndex].originalSystemEventId,
                reference: afterDollars[creditCardTransactionsIndex].referenceNumber,
                debitDate: afterDollars[creditCardTransactionsIndex].debitDate,
                originalAmount: (afterDollars[creditCardTransactionsIndex].originalAmount !=
                      afterDollars[creditCardTransactionsIndex].debitAmount) ? afterDollars[creditCardTransactionsIndex].originalAmount : undefined,
                originalCurrency: (afterDollars[creditCardTransactionsIndex].originalAmount !=
                      afterDollars[creditCardTransactionsIndex].debitAmount) ? afterDollars[creditCardTransactionsIndex].eventCurrencyDescription : undefined,
              };
              creditCardDollarsTransactions.push(transaction);
            }
          }

          if (afterEuros) {
            for (
              let creditCardTransactionsIndex = 0;
              creditCardTransactionsIndex < afterEuros.length;
              creditCardTransactionsIndex += 1) {
              const transaction = {
                amount: afterEuros[creditCardTransactionsIndex].debitAmount,
                currency: afterEuros[creditCardTransactionsIndex].debitCurrencyCode,
                date: afterEuros[creditCardTransactionsIndex].eventDate,
                business: (afterEuros[creditCardTransactionsIndex].clientBusinessName) ? afterEuros[creditCardTransactionsIndex].clientBusinessName.substring(
                  afterEuros[creditCardTransactionsIndex].clientBusinessName.indexOf('~') + 1,
                ) : '',
                eventId: afterEuros[creditCardTransactionsIndex].originalSystemEventId,
                reference: afterEuros[creditCardTransactionsIndex].referenceNumber,
                debitDate: afterEuros[creditCardTransactionsIndex].debitDate,
                originalAmount: (afterEuros[creditCardTransactionsIndex].originalAmount !=
                      afterEuros[creditCardTransactionsIndex].debitAmount) ? afterEuros[creditCardTransactionsIndex].originalAmount : undefined,
                originalCurrency: (afterEuros[creditCardTransactionsIndex].originalAmount !=
                      afterEuros[creditCardTransactionsIndex].debitAmount) ? afterEuros[creditCardTransactionsIndex].eventCurrencyDescription : undefined,
              };
              creditCardEuroTransactions.push(transaction);
            }
          }
        }
      }
    });

    let creditShekelsBalance = 0;
    const creditShekelsAbroadBalance = 0;
    let creditDollarsBalance = 0;
    let creditEurosBalance = 0;
    if (creditCardTxnsResult) {
      for (
        let creditCardAccountbalancesIndex = 0;
        creditCardAccountbalancesIndex < creditCardTxnsResult.plasticCardAccountSummeryList.length;
        creditCardAccountbalancesIndex += 1) {
        switch (creditCardTxnsResult.plasticCardAccountSummeryList[creditCardAccountbalancesIndex].debitCurrencyCode) {
          case 0:
            creditShekelsBalance =
                creditCardTxnsResult.plasticCardAccountSummeryList[creditCardAccountbalancesIndex].debitAmount;
            break;
          case 19:
            creditDollarsBalance =
                creditCardTxnsResult.plasticCardAccountSummeryList[creditCardAccountbalancesIndex].debitAmount;
            break;
          case 100:
            creditEurosBalance =
                creditCardTxnsResult.plasticCardAccountSummeryList[creditCardAccountbalancesIndex].debitAmount;
            break;

          default:
            break;
        }
      }
    }

    accounts.push({
      accountNumber,

      checkingShekelsBalance,
      checkingDollarsBalance,
      checkingDollarsBalanceInShekels,
      checkingEuroBalance,
      checkingEuroBalanceInShekels,
      creditShekelsBalance,
      creditShekelsAbroadBalance,
      creditDollarsBalance,
      creditEurosBalance,

      checkingTransactions: txns,
      checkingDollarTransactions,
      checkingEuroTransactions,
      creditCardShekelsTransactions,
      creditCardDollarsTransactions,
      creditCardEuroTransactions,
    });
  }

  const accountData = {
    success: true,
    accounts,
  };

  return accountData;
}
