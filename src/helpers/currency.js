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

function parseAmount(amountStr) {
  if (typeof amountStr === 'number') {
    return amountStr;
  }

  if (!amountStr && amountStr !== '0') {
    throw new Error('cannot resolve currency value, no currency symbol provided');
  }

  const formattedAmount = amountStr
    .replace(SHEKEL_CURRENCY_SYMBOL, '')
    .replace(DOLLAR_CURRENCY_SYMBOL, '')
    .replace(',', '')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
  let currency = SHEKEL_CURRENCY;
  let amount = null;
  const parts = formattedAmount.split(' ');

  amount = parseFloat(parts[0]);
  if (parts.length === 2) {
    currency = fromCurrencySymbolToValue(parts[1]);

    if (currency === null) {
      throw new Error(`cannot parse amount, failed to detect currency for '${amountStr}'`);
    }
  }

  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    throw new Error(`cannot parse amount, failed to detect amount for '${amountStr}'`);
  }

  return {
    amount,
    currency,
  };
}

export { parseAmount, fromCurrencySymbolToValue };
