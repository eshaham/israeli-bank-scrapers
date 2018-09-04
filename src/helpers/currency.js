import {
  SHEKEL_CURRENCY_SYMBOL,
  SHEKEL_CURRENCY,
  DOLLAR_CURRENCY_SYMBOL,
  DOLLAR_CURRENCY,
} from '../constants';

function fromCurrencySymbolToValue(symbol) {
  if (!symbol) {
    throw new Error('cannot resolve currency value, no currency symbol provided');
  }

  switch (symbol.toUpperCase()) {
    case SHEKEL_CURRENCY_SYMBOL:
    case SHEKEL_CURRENCY:
      return SHEKEL_CURRENCY;
    case DOLLAR_CURRENCY_SYMBOL:
    case DOLLAR_CURRENCY:
      return DOLLAR_CURRENCY;
    default:
      throw new Error(`cannot resolve currency value, unknown symbol ${symbol}`);
  }
}

export default fromCurrencySymbolToValue;
