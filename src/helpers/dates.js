import moment from 'moment';

export default function getAllMonthMoments(startMoment) {
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths = [];
  const startOfNextMonth = moment().startOf('month').add(1, 'month');
  while (monthMoment.isSameOrBefore(startOfNextMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
