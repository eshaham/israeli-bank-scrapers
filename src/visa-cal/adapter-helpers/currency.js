import {
  DOLLAR_CURRENCY, DOLLAR_CURRENCY_SYMBOL, SHEKEL_CURRENCY, SHEKEL_CURRENCY_SYMBOL,
} from '../../../constants';


export function convertCurrency(currency) {
  switch (currency) {
    case SHEKEL_CURRENCY_SYMBOL:
      return SHEKEL_CURRENCY;
    case DOLLAR_CURRENCY_SYMBOL:
      return DOLLAR_CURRENCY;
    default:
      return currency;
  }
}
