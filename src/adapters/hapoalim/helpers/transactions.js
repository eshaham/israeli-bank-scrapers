import uuid4 from 'uuid/v4';
import moment from 'moment';
import { DATE_FORMAT } from '../definitions';
import { fetchPostWithinPage, fetchGetWithinPage } from './helpers/fetch';
import {NORMAL_TXN_TYPE, TRANSACTION_STATUS} from "../../../constants";

const DefaultStartMoment = moment().subtract(1, 'years').add(1, 'day');

export function getTransactionsUrl(page, options) {
  const { apiSiteUrl, accountToken, filterToken } = options;

  const startDate = options.startDate || DefaultStartMoment.toDate();
  const startMoment = moment.max(DefaultStartMoment, moment(startDate));

  const startDateStr = startMoment.format(DATE_FORMAT);
  const endDateStr = moment().format(DATE_FORMAT);

  return `${apiSiteUrl}/current-account/transactions?accountId=${accountToken}${filterToken ? `&dataGroupCatenatedKey=${filterToken}` : ''}&numItemsPerPage=150&retrievalEndDate=${endDateStr}&retrievalStartDate=${startDateStr}&lang=he`;
}

// TODO es remove duplication
export async function fetchGetPoalimXSRFWithinPage(page, url) {
  const cookies = await page.cookies();
  const XSRFCookie = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
  const headers = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = '/current-account/transactions';
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchGetWithinPage(page, url, headers);
}

export async function fetchPoalimXSRFWithinPage(page, url) {
  const cookies = await page.cookies();
  const XSRFCookie = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
  const headers = {};
  if (XSRFCookie != null) {
    headers['X-XSRF-TOKEN'] = XSRFCookie.value;
  }
  headers.pageUuid = '/current-account/transactions';
  headers.uuid = uuid4();
  headers['Content-Type'] = 'application/json;charset=UTF-8';
  return fetchPostWithinPage(page, url, [], headers);
}

export function convertTransaction(txn) {
  const isOutbound = txn.eventActivityTypeCode === 2;

  let memo = null;
  if (txn.beneficiaryDetailsData) {
    const {
      partyHeadline,
      partyName,
      messageHeadline,
      messageDetail,
    } = txn.beneficiaryDetailsData;
    const memoLines = [];
    if (partyHeadline) {
      memoLines.push(partyHeadline);
    }

    if (partyName) {
      memoLines.push(`${partyName}.`);
    }

    if (messageHeadline) {
      memoLines.push(messageHeadline);
    }

    if (messageDetail) {
      memoLines.push(`${messageDetail}.`);
    }

    if (memoLines.length) {
      memo = memoLines.join(' ');
    }
  }

  return {
    type: NORMAL_TXN_TYPE,
    identifier: txn.referenceNumber,
    date: moment(txn.eventDate, DATE_FORMAT).toISOString(),
    processedDate: moment(txn.valueDate, DATE_FORMAT).toISOString(),
    originalAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
    originalCurrency: 'ILS',
    chargedAmount: isOutbound ? -txn.eventAmount : txn.eventAmount,
    description: txn.activityDescription,
    status: txn.serialNumber === 0 ? TRANSACTION_STATUS.PENDING : TRANSACTION_STATUS.COMPLETED,
    memo,
  };
}
