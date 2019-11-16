import HapoalimScraper from './hapoalim';
import OtsarHahayalScraper from './otsar-hahayal';
import LeumiScraper from './leumi';
import DiscountScraper from './discount';
import LeumiCardScraper from './leumi-card';
import VisaCalScraper from './visa-cal';
import IsracardScraper from './isracard';
import AmexScraper from './amex';
import MizrahiScraper from './mizrahi';
import HapoalimBeOnlineScraper from './hapoalim-beonline';

export default function createScraper(options) {
  switch (options.companyId) {
    case 'hapoalim':
      return new HapoalimScraper(options);
    case 'hapoalimBeOnline':
      return new HapoalimBeOnlineScraper(options);
    case 'leumi':
      return new LeumiScraper(options);
    case 'mizrahi':
      return new MizrahiScraper(options);
    case 'discount':
      return new DiscountScraper(options);
    case 'otsarHahayal':
      return new OtsarHahayalScraper(options);
    case 'visaCal':
      return new VisaCalScraper(options);
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
