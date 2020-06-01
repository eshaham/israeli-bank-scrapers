// NOTICE: avoid changing exported keys as they are part of the public api

export const PASSWORD_FIELD = 'password';

export enum CompanyTypes {
  hapoalim = 'hapoalim',
  hapoalimBeOnline = 'hapoalimBeOnline',
  beinleumi = 'beinleumi',
  union = 'union',
  amex = 'amex',
  isracard = 'isracard',
  visaCal = 'visaCal',
  max = 'max',
  leumiCard = 'leumiCard',
  otsarHahayal = 'otsarHahayal',
  discount = 'discount',
  mizrahi = 'mizrahi',
  leumi = 'leumi'
}

export const SCRAPERS = {
  [CompanyTypes.hapoalim]: {
    name: 'Bank Hapoalim',
    loginFields: ['userCode', PASSWORD_FIELD],
  },
  [CompanyTypes.hapoalimBeOnline]: { // TODO remove in Major version
    name: 'Bank Hapoalim',
    loginFields: ['userCode', PASSWORD_FIELD],
  },
  [CompanyTypes.leumi]: {
    name: 'Bank Leumi',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.mizrahi]: {
    name: 'Mizrahi Bank',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.discount]: {
    name: 'Discount Bank',
    loginFields: ['id', PASSWORD_FIELD, 'num'],
  },
  [CompanyTypes.otsarHahayal]: {
    name: 'Bank Otsar Hahayal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.leumiCard]: { // TODO remove in Major version
    name: 'Leumi Card',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.max]: {
    name: 'Max',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.visaCal]: {
    name: 'Visa Cal',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.isracard]: {
    name: 'Isracard',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
  [CompanyTypes.amex]: {
    name: 'Amex',
    loginFields: ['id', 'card6Digits', PASSWORD_FIELD],
  },
  [CompanyTypes.union]: {
    name: 'Union',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.beinleumi]: {
    name: 'Beinleumi',
    loginFields: ['username', PASSWORD_FIELD],
  },
};
