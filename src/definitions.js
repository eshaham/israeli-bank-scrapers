export const PASSWORD_FIELD = 'password';

export const SCRAPERS = {
  discount: {
    name: 'Discount Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
  },
  leumiCard: {
    name: 'Leumi Card',
    loginFields: ['username', PASSWORD_FIELD],
  },
  isracard: {
    name: 'Isracard',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
};
