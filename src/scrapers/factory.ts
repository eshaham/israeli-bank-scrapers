import { assertNever } from '../assertNever';
import { CompanyTypes } from '../definitions';
import AmexScraper from './amex';
import BehatsdaaScraper from './behatsdaa';
import BeinleumiScraper from './beinleumi';
import BeyahadBishvilhaScraper from './beyahad-bishvilha';
import DiscountScraper from './discount';
import HapoalimScraper from './hapoalim';
import { Scraper, ScraperCredentials, ScraperOptions } from './interface';
import IsracardScraper from './isracard';
import LeumiScraper from './leumi';
import MassadScraper from './massad';
import MaxScraper from './max';
import MercantileScraper from './mercantile';
import MizrahiScraper from './mizrahi';
import OneZeroScraper from './one-zero';
import OtsarHahayalScraper from './otsar-hahayal';
import UnionBankScraper from './union-bank';
import VisaCalScraper from './visa-cal';
import YahavScraper from './yahav';

export default function createScraper(options: ScraperOptions): Scraper<ScraperCredentials> {
  switch (options.companyId) {
    case CompanyTypes.hapoalim:
      return new HapoalimScraper(options);
    case CompanyTypes.hapoalimBeOnline:
      // eslint-disable-next-line no-console
      console.warn("hapoalimBeOnline is deprecated, use 'hapoalim' instead");
      return new HapoalimScraper(options);
    case CompanyTypes.leumi:
      return new LeumiScraper(options);
    case CompanyTypes.beyahadBishvilha:
      return new BeyahadBishvilhaScraper(options);
    case CompanyTypes.mizrahi:
      return new MizrahiScraper(options);
    case CompanyTypes.discount:
      return new DiscountScraper(options);
    case CompanyTypes.mercantile:
      return new MercantileScraper(options);
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
    case CompanyTypes.oneZero:
      return new OneZeroScraper(options);
    case CompanyTypes.behatsdaa:
      return new BehatsdaaScraper(options);
    default:
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      return assertNever(options.companyId, `unknown company id ${options.companyId}`);
  }
}
