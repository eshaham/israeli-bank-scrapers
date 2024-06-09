// eslint-disable-next-line import/named
import moment, { Moment } from 'moment';

export default function getAllMonthMoments(startMoment: Moment | string, futureMonths?: number) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];
  let lastMonth = moment().startOf('month');
  if (futureMonths && futureMonths > 0) {
    lastMonth = lastMonth.add(futureMonths, 'month');
  }
  while (monthMoment.isSameOrBefore(lastMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
