export const PASSWORD_FIELD = 'password';

export const SCRAPERS = {
  hapoalim: {
    name: 'Bank Hapoalim',
    loginFields: ['userCode', PASSWORD_FIELD],
  },
  discount: {
    name: 'Discount Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
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
