import DiscountScraper from './discount';
import LeumiCardScraper from './leumi-card';
import VisaCalScraper from './visa-cal';
import IsracardScraper from './isracard';
import AmexScraper from './amex';
import HapoalimScraper from './hapoalim';

export default function createScraper(options) {
  switch (options.companyId) {
    case 'discount':
      return new DiscountScraper(options);
    case 'visaCal':
      return new VisaCalScraper(options);
    case 'leumiCard':
      return new LeumiCardScraper(options);
    case 'isracard':
      return new IsracardScraper(options);
    case 'amex':
      return new AmexScraper(options);
    case 'hapoalim':
      return new HapoalimScraper(options);
    default:
      throw new Error(`unknown company id ${options.companyId}`);
  }
}
