import { pickOtpTarget } from './beinleumi-otp';

describe('Beinleumi one-time code', () => {
  test('picks the phone that ends with the given digits', () => {
    const targets = ['******1111', '******2222'];
    expect(pickOtpTarget(targets, '2222')).toBe(1);
    expect(pickOtpTarget(targets, '0501112222')).toBe(1);
  });

  test('falls back to the first phone listed', () => {
    expect(pickOtpTarget(['******1111', '******2222'], '9999')).toBe(0);
    expect(pickOtpTarget(['******1111', '******2222'])).toBe(0);
  });

  test('returns -1 when no phones are listed', () => {
    expect(pickOtpTarget([])).toBe(-1);
  });
});
