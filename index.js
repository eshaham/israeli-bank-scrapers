import DiscountScraper from './lib/scrapers/discount';
import LeumiCardScraper from './lib/scrapers/leumi-card';

const discountScraper = new DiscountScraper().scrape;
const leumiCardScraper = new LeumiCardScraper().scrape;

export { discountScraper, leumiCardScraper };
