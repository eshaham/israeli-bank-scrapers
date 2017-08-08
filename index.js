import DiscountScraper from './lib/scrapers/discount';
import LeumiCardScraper from './lib/scrapers/leumi-card';

function discountScraper(credentials, options) {
  const scraper = new DiscountScraper();
  return scraper.scrape(credentials, options);
}

function leumiCardScraper(credentials, options) {
  const scraper = new LeumiCardScraper();
  return scraper.scrape(credentials, options);
}

export { discountScraper, leumiCardScraper };
