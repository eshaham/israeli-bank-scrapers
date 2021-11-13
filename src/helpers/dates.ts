import moment, { Moment } from 'moment';

export default function getAllMonthMoments(startMoment: Moment | string, scrapeXFutureMonths?: number) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];
  let lastMonth = moment().startOf('month');
  if (scrapeXFutureMonths && scrapeXFutureMonths > 0) {
    lastMonth = lastMonth.add(scrapeXFutureMonths, 'month');
  }
  while (monthMoment.isSameOrBefore(lastMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
