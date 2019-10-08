import moment from 'moment';


const minimalDate = moment().subtract(1, 'years').add(1, 'day');

export function validateStartDate(startDate) {
  let isValid = true;
  if (!startDate) {
    return ['missing start date'];
  }

  const startDateMoment = moment(startDate);
  if (!moment.isMoment(startDateMoment)) {
    isValid = false;
  } else if (startDateMoment.isBefore(minimalDate)) {
    isValid = false;
  }


  if (!isValid) {
    const minimalDateAsString = minimalDate.format('dddd, MMMM Do YYYY');
    return [`invalid start date, expected date higher than ${minimalDateAsString} `];
  }

  return [];
}


export function getAllMonthMoments(startMoment, includeNext) {
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
