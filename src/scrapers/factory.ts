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
import MassadScraper from './massad';
import YahavScraper from './yahav';
import { ScaperOptions } from './base-scraper';
import { CompanyTypes } from '../definitions';

export default function createScraper(options: ScaperOptions) {
  switch (options.companyId) {
    case CompanyTypes.hapoalim:
      return new HapoalimScraper(options);
    case CompanyTypes.hapoalimBeOnline:
      // eslint-disable-next-line no-console
      console.warn("hapoalimBeOnline is deprecated, use 'hapoalim' instead");
      return new HapoalimScraper(options);
    case CompanyTypes.leumi:
      return new LeumiScraper(options);
    case CompanyTypes.mizrahi:
      return new MizrahiScraper(options);
    case CompanyTypes.discount:
      return new DiscountScraper(options);
    case CompanyTypes.otsarHahayal:
      return new OtsarHahayalScraper(options);
    case CompanyTypes.visaCal:
      return new VisaCalScraper(options);
    case CompanyTypes.leumiCard:
      // eslint-disable-next-line no-console
      console.warn("leumiCard is deprecated, use 'max' instead");
      return new MaxScraper(options);
    case CompanyTypes.max:
      return new MaxScraper(options);
    case CompanyTypes.isracard:
      return new IsracardScraper(options);
    case CompanyTypes.amex:
      return new AmexScraper(options);
    case CompanyTypes.union:
      return new UnionBankScraper(options);
    case CompanyTypes.beinleumi:
      return new BeinleumiScraper(options);
    case CompanyTypes.massad:
      return new MassadScraper(options);
    case CompanyTypes.yahav:
      return new YahavScraper(options);
    default:
      throw new Error(`unknown company id ${options.companyId}`);
  }
}
