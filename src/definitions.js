export const PASSWORD_FIELD = 'password';

export const SCRAPERS = {
  hapoalim: {
    name: 'Bank Hapoalim',
    loginFields: ['userCode', PASSWORD_FIELD],
  },
  leumi: {
    name: 'Bank Leumi',
    loginFields: ['username', PASSWORD_FIELD],
  },
  discount: {
    name: 'Discount Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
  },
  otsarHahayal: {
    name: 'Bank Otsar Hahayal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  leumiCard: {
    name: 'Leumi Card',
    loginFields: ['username', PASSWORD_FIELD],
  },
  visaCal: {
    name: 'Visa Cal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  isracard: {
    name: 'Isracard',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
  amex: {
    name: 'Amex',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
};

export function isValidCredentials(scraperId, credentials) {
  if (!scraperId || typeof credentials !== 'object') {
    return false;
  }

  const scraperDefinitions = SCRAPERS[scraperId];

  if (!scraperDefinitions || !scraperDefinitions.loginFields) {
    return false;
  }

  const hasMissingField = scraperDefinitions.loginFields.some(field => typeof credentials[field] === 'undefined');

  return !hasMissingField;
}
