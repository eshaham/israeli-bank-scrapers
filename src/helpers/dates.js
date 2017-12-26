import moment from 'moment';

export default function getAllMonthMoments(startMoment, includeNext) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths = [];
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
