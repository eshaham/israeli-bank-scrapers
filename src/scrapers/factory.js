import DiscountScraper from './discount';
import LeumiCardScraper from './leumi-card';
import IsracardScraper from './isracard';
import AmexScraper from './amex';
import VisaCalScraper from './visa-cal';

export default function createScraper(options) {
  switch (options.companyId) {
    case 'visa':
      return new VisaCalScraper(options);
    case 'discount':
      return new DiscountScraper(options);
    case 'leumiCard':
      return new LeumiCardScraper(options);
    case 'isracard':
      return new IsracardScraper(options);
    case 'amex':
      return new AmexScraper(options);
    default:
      throw new Error(`unknown company id ${options.companyId}`);
  }
}
