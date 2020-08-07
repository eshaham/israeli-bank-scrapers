import moment, { Moment } from 'moment';

export default function getAllMonthMoments(startMoment: Moment | string, includeNext: boolean) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];
  let lastMonth = moment().startOf('month');
  if (includeNext) {
    lastMonth = lastMonth.add(1, 'month');
  }
  while (monthMoment.isSameOrBefore(lastMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
