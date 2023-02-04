import puppeteerConfig from './puppeteer-config.json';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS, CompanyTypes } from './definitions';

// Note: the typo ScaperScrapingResult is extracted here for backward compatibility
export {
  ScraperOptions, ScraperScrapingResult as ScaperScrapingResult, ScraperScrapingResult,
  TwoFactorAuthScraper, Scraper,
} from './scrapers/interface';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}
