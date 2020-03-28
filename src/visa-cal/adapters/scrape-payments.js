import moment from 'moment';
import _ from 'lodash';
import { fetchGet } from '@core/helpers/fetch';
import { validateInThePastYear } from '@core/helpers/dates';
import { convertCurrency } from '../adapter-helpers/currency';
import { HEADER_SITE, BASE_URL, DATE_FORMAT } from '../definitions';
import { getBankDebitsUrl } from '../adapter-helpers/urls';

function convertPayments(payments, bankAccountNumber) {
  return payments.map((payment) => {
    return {
      accountNumber: payment.CardLast4Digits,
      bankAccountNumber,
      date: moment(payment.Date, DATE_FORMAT).toISOString(),
      TransactionsCount: payment.TransactionsCount,
      amount: payment.Amount.Value,
      originalCurrency: convertCurrency(payment.Amount.Symbol),
    };
  });
}

async function getBankDebits(authHeader, accountId, startDate) {
  const bankDebitsUrl = getBankDebitsUrl(accountId, startDate);
  return fetchGet(bankDebitsUrl, authHeader);
}

async function getPaymentsForAllAccounts(authHeader, startDate) {
  const cardsByAccountUrl = `${BASE_URL}/CardsByAccounts`;
  const banksResponse = await fetchGet(cardsByAccountUrl, authHeader);

  if (!_.get(banksResponse, 'Response.Status.Succeeded')) {
    return new Error('failed to get bank accounts list');
  }

  const accounts = [];
  for (let i = 0; i < banksResponse.BankAccounts.length; i += 1) {
    const bank = banksResponse.BankAccounts[i];
    const bankDebits = await getBankDebits(authHeader, bank.AccountID, startDate);
    if (_.get(bankDebits, 'Response.Status.Succeeded')) {
      const payments = convertPayments(bankDebits.Debits, bank.AccountNumber);
      const paymentsByAccounts = _.groupBy(payments, 'accountNumber');
      Object.entries(paymentsByAccounts).forEach(([accountNumber, payments]) => {
        const result = {
          accountNumber,
          payments: payments.map((payment) => {
            const { accountNumber, ...rest } = payment;
            return rest;
          }),
        };
        accounts.push(result);
      });
    }
  }
  return accounts;
}

export function scrapePaymentsAdapter(options) {
  return {
    name: 'scrapePayments(visaCal)',
    validate: (context) => {
      const result = [];
      const [startDateValidationMessage] = validateInThePastYear(options.startDate);

      if (startDateValidationMessage) {
        result.push(startDateValidationMessage);
      }

      if (!context.hasSessionData('visaCal.authHeader')) {
        result.push('expected \'visaCal.authHeader\' to be provided by prior adapter');
      }

      return result;
    },
    action: async (context) => {
      const defaultStartMoment = moment().subtract(1, 'years');
      const startDate = options.startDate || defaultStartMoment.toDate();
      const startMoment = moment.max(defaultStartMoment, moment(startDate));

      const authHeader = {
        Authorization: context.getSessionData('visaCal.authHeader'),
        ...HEADER_SITE,
      };
      const accounts = await getPaymentsForAllAccounts(authHeader, startMoment, options);

      return {
        data: {
          visaCal: {
            payments: {
              accounts,
            },
          },
        },
      };
    },
  };
}
