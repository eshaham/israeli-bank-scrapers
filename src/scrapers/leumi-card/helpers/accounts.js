import moment from 'moment';
import buildUrl from 'build-url';
import { BASE_ACTIONS_URL } from '../definitions';
import { waitForNavigationAndDomLoad } from '../../../helpers/navigation';
import { SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL } from '../../../constants';
// import getAllMonthMoments from '../../../helpers/dates';

function getTransactionsUrl(monthMoment) {
  let monthCharge = null;
  let actionType = 1;
  if (monthMoment) {
    const month = monthMoment.month() + 1;
    const monthStr = month < 10 ? `0${month}` : month.toString();
    const year = monthMoment.year();
    monthCharge = `${year}${monthStr}`;
    actionType = 2;
  }
  return buildUrl(BASE_ACTIONS_URL, {
    path: 'Registred/Transactions/ChargesDeals.aspx',
    queryParams: {
      ActionType: actionType,
      MonthCharge: monthCharge,
      Index: -2,
    },
  });
}
async function getCardContainers(page) {
  return page.$$('.infoList_holder');
}

async function getCardContainer(page, cardIndex) {
  const cardContainers = await getCardContainers(page);
  const cardContainer = cardContainers[cardIndex];
  return cardContainer;
}

async function getCardSections(page, cardIndex) {
  const cardContainer = await getCardContainer(page, cardIndex);
  const cardSections = await cardContainer.$$('.NotPaddingTable');
  return cardSections;
}

async function getAccountNumber(page, cardIndex) {
  const cardContainer = await getCardContainer(page, cardIndex);
  const infoContainer = await cardContainer.$('.creditCard_name');
  const numberListItems = await infoContainer.$$('li');
  const numberListItem = numberListItems[1];
  const accountNumberStr = await page.evaluate((li) => {
    return li.innerText;
  }, numberListItem);
  const accountNumber = accountNumberStr.replace('(', '').replace(')', '');

  return accountNumber;
}

async function getNextPageButtonForSection(page, cardIndex, sectionIndex) {
  const cardSections = await getCardSections(page, cardIndex);
  return cardSections[sectionIndex].$('.difdufLeft a');
}


function getAmountData(amountStr) {
  const amountStrCopy = amountStr.replace(',', '');
  let currency = null;
  let amount = null;
  if (amountStrCopy.includes(SHEKEL_CURRENCY_SYMBOL)) {
    amount = parseFloat(amountStrCopy.replace(SHEKEL_CURRENCY_SYMBOL, ''));
    currency = SHEKEL_CURRENCY;
  } else {
    const parts = amountStrCopy.split(' ');
    amount = parseFloat(parts[0]);
    [, currency] = parts;
  }

  return {
    amount,
    currency,
  };
}

async function extractPayments(page, cardSection) {
  const trs = await cardSection.$$('tr.creditTotal');

  return Promise.all(trs.map(async (tr) => {
    const tds = await tr.$$('td');

    const dateStr = await page.evaluate((td) => {
      return td.innerText.match(/(\d\d\/?){3}/g)[0];
    }, tds[2]);

    const value = await page.evaluate((td) => {
      return td.innerText;
    }, tds[3]);

    return Object.assign(
      {
        date: moment(dateStr, 'DD/MM/YY', true).toISOString(),
      },
      getAmountData(value),
    );
  }));
}


async function mapCurrentPageCards(page, mapper) {
  const result = {};
  const cardContainers = await getCardContainers(page);

  for (let cardIndex = 0; cardIndex < cardContainers.length; cardIndex += 1) {
    let rows = [];
    const cardSections = await getCardSections(page, cardIndex);
    for (let sectionIndex = 0; sectionIndex < cardSections.length; sectionIndex += 1) {
      let hasNext = true;
      while (hasNext) {
        const cardSections = await getCardSections(page, cardIndex);
        const cardSection = await cardSections[sectionIndex];
        const cardSectionRows = await mapper(page, cardSection);
        rows = [...rows, ...cardSectionRows];

        const nextPageBtn = await getNextPageButtonForSection(page, cardIndex, sectionIndex);
        if (nextPageBtn) {
          await nextPageBtn.click();
          await waitForNavigationAndDomLoad(page);
        } else {
          hasNext = false;
        }
      }
    }

    const accountNumber = await getAccountNumber(page, cardIndex);
    result[accountNumber] = rows;
  }

  return result;
}

// async function navigateToCardsByMonth(page, monthMoment) {
//   const url = getTransactionsUrl(monthMoment);
//   await navigateTo(page, url);
//
//   if (page.url() !== url) {
//     throw new Error(`Error while trying to navigate to url ${url}`);
//   }
// }

async function mapCardsByMonths() {
  return {};
}

// async function mapCardsByMonths(page, options, mapper) {
//   const { startDate } = options;
//   const startMoment = moment.max(moment(startDate));
//   const allMonths = getAllMonthMoments(startMoment, false);
//
//   const result = {};
//   for (let i = 0; i < allMonths.length; i += 1) {
//     await navigateToCardsByMonth(page, allMonths[i]);
//     const cardPaymentMap = mapCurrentPageCards(page, mapper);
//   Object.entries(cardPaymentMap).forEach(([accountName, payments]) => {
//     if (!result[accountName]) {
//       result[accountName] = [];
//     }
//
//     result[accountName].push(...payments);
//   });
//   result = addResult(result, await mapper(page));
//   }
//
//   await navigateToCardsByMonth(page);
//   const cardPaymentMap = mapCurrentPageCards(page, mapper);
//
//   result = addResult(result, await mapper(page));
//
//   Object.keys(result).forEach((accountNumber) => {
//     let txns = result[accountNumber];
//     txns = prepareTransactions(txns, startMoment, options.combineInstallments);
//     result[accountNumber] = txns;
//   });
//
//   return result;
// }

export {
  mapCardsByMonths,
  getTransactionsUrl,
  mapCurrentPageCards,
  getAmountData,
  extractPayments,
};
