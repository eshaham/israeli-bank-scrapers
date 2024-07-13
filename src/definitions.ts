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
  mercantile = 'mercantile',
  mizrahi = 'mizrahi',
  leumi = 'leumi',
  massad = 'massad',
  yahav = 'yahav',
  behatsdaa = 'behatsdaa',
  beyahadBishvilha = 'beyahadBishvilha',
  oneZero = 'oneZero',
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
  [CompanyTypes.mercantile]: {
    name: 'Mercantile Bank',
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
  [CompanyTypes.massad]: {
    name: 'Massad',
    loginFields: ['username', PASSWORD_FIELD],
  },
  [CompanyTypes.yahav]: {
    name: 'Bank Yahav',
    loginFields: ['username', 'nationalID', PASSWORD_FIELD],
  },
  [CompanyTypes.beyahadBishvilha]: {
    name: 'Beyahad Bishvilha',
    loginFields: ['id', PASSWORD_FIELD],
  },
  [CompanyTypes.oneZero]: {
    name: 'One Zero',
    loginFields: ['email', PASSWORD_FIELD, 'otpCodeRetriever', 'phoneNumber', 'otpLongTermToken'],
  },
  [CompanyTypes.behatsdaa]: {
    name: 'Behatsdaa',
    loginFields: ['id', PASSWORD_FIELD],
  },
};

export enum ScraperProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  EndScraping = 'END_SCRAPING',
  Terminating = 'TERMINATING',
}
