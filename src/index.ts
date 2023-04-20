import puppeteerConfig from './puppeteer-config.json';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS, CompanyTypes } from './definitions';

// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility
export {
  ScraperOptions,
  ScraperScrapingResult as ScaperScrapingResult,
  ScraperScrapingResult,
  ScraperLoginResult as ScaperLoginResult,
  ScraperLoginResult,
  ScraperCredentials,
} from './scrapers/interface';

export type { BaseScraper as Scraper } from './scrapers/base-scraper';

export { default as OneZeroScraper } from './scrapers/one-zero';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}
