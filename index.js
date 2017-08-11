import DiscountScraper from './lib/scrapers/discount';
import LeumiCardScraper from './lib/scrapers/leumi-card';
import IsracardScraper from './lib/scrapers/isracard';

function discountScraper(credentials, options) {
  const scraper = new DiscountScraper();
  return scraper.scrape(credentials, options);
}

function leumiCardScraper(credentials, options) {
  const scraper = new LeumiCardScraper();
  return scraper.scrape(credentials, options);
}

function isracardScraper(credentials, options) {
  const scraper = new IsracardScraper();
  return scraper.scrape(credentials, options);
}

export { discountScraper, leumiCardScraper, isracardScraper };
