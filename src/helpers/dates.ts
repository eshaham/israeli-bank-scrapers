import moment, { Moment } from 'moment';

export default function getAllMonthMoments(startMoment: Moment | string, endMoment: Moment | string) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];

  while (monthMoment.isSameOrBefore(endMoment)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
