import 'babel-polyfill';
import DiscountScraper from './scrapers/discount';
import LeumiCardScraper from './scrapers/leumi-card';
import IsracardScraper from './scrapers/isracard';

const scrapers = {
  discount: DiscountScraper,
  leumiCard: LeumiCardScraper,
  isracard: IsracardScraper,
};

export default function createScraper(options) {
  if (!scrapers[options.companyId]) {
    return null;
  }

  return new scrapers[options.companyId](options);
}
