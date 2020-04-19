import HapoalimScraper from './hapoalim';
import OtsarHahayalScraper from './otsar-hahayal';
import LeumiScraper from './leumi';
import DiscountScraper from './discount';
import MaxScraper from './max';
import VisaCalScraper from './visa-cal';
import IsracardScraper from './isracard';
import AmexScraper from './amex';
import MizrahiScraper from './mizrahi';
import UnionBankScraper from './union-bank';
import BeinleumiScraper from './beinleumi';

export default function createScraper(options) {
  switch (options.companyId) {
    case 'hapoalim':
      return new HapoalimScraper(options);
    case 'hapoalimBeOnline':
      // eslint-disable-next-line no-console
      console.warn("hapoalimBeOnline is deprecated, use 'hapoalim' instead");
      return new HapoalimScraper(options);
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
      // eslint-disable-next-line no-console
      console.warn("leumiCard is deprecated, use 'max' instead");
      return new MaxScraper(options);
    case 'max':
      return new MaxScraper(options);
    case 'isracard':
      return new IsracardScraper(options);
    case 'amex':
      return new AmexScraper(options);
    case 'union':
      return new UnionBankScraper(options);
    case 'beinleumi':
      return new BeinleumiScraper(options);
    default:
      throw new Error(`unknown company id ${options.companyId}`);
  }
}
