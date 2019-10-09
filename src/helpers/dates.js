import moment from 'moment';

export function validateDateInRange(startDate, afterDate) {
  const afterDateAsMoment = moment(afterDate);
  let isValid = true;
  if (!startDate) {
    return ['missing start date'];
  }

  const startDateMoment = moment(startDate);
  if (!moment.isMoment(startDateMoment)) {
    isValid = false;
  } else if (startDateMoment.isBefore(afterDateAsMoment)) {
    isValid = false;
  }


  if (!isValid) {
    const afterDateAsString = afterDateAsMoment.format('dddd, MMMM Do YYYY');
    return [`invalid start date, expected date higher than ${afterDateAsString} `];
  }

  return [];
}

export function validateInThePastYear(startDate) {
  const minimalDate = moment().subtract(1, 'years').add(1, 'day');
  return validateDateInRange(startDate, minimalDate);
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
