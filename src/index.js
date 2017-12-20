import 'babel-polyfill';
import DiscountScraper from './scrapers/discount';
import LeumiCardScraper from './scrapers/leumi-card';
import IsracardScraper from './scrapers/isracard';

function discountScraper(credentials, options) {
  const scraper = new DiscountScraper(options);
  return scraper.scrape(credentials);
}

function leumiCardScraper(credentials, options) {
  const scraper = new LeumiCardScraper(options);
  return scraper.scrape(credentials);
}

function isracardScraper(credentials, options) {
  const scraper = new IsracardScraper(options);
  return scraper.scrape(credentials);
}

export { discountScraper, leumiCardScraper, isracardScraper };
