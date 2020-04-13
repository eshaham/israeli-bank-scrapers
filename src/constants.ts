export const NORMAL_TXN_TYPE = 'normal';
export const INSTALLMENTS_TXN_TYPE = 'installments';

export const SHEKEL_CURRENCY_SYMBOL = '₪';
export const SHEKEL_CURRENCY_KEYWORD = 'ש"ח';
export const ALT_SHEKEL_CURRENCY = 'NIS';
export const SHEKEL_CURRENCY = 'ILS';

export const DOLLAR_CURRENCY_SYMBOL = '$';
export const DOLLAR_CURRENCY = 'USD';

export const ScrapeProgressTypes = {
  Initializing: 'INITIALIZING',
  StartScraping: 'START_SCRAPING',
  LoggingIn: 'LOGGING_IN',
  LoginSuccess: 'LOGIN_SUCCESS',
  LoginFailed: 'LOGIN_FAILED',
  ChangePassword: 'CHANGE_PASSWORD',
  EndScraping: 'END_SCRAPING',
  Terminating: 'TERMINATING',
};


export enum LoginResults {
  Success = 'Success',
  InvalidPassword = 'InvalidPassword',
  ChangePassword = 'ChangePassword',
  UnknownError = 'UnknownError',
}

export const ERRORS = {
  TIMEOUT: 'TIMEOUT',
  GENERIC: 'GENERIC',
};


export enum TransactionStatuses {
  Completed = 'completed',
  Pending = 'pending'
}

export const ISO_DATE_FORMAT = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';
export const ISO_DATE_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])T([0-1][0-9]|2[0-3])(:[0-5][0-9]){2}\.[0-9]{3}Z$/;
