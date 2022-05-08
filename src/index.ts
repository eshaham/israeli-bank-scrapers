import puppeteerConfig from './puppeteer-config.json';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS, CompanyTypes } from './definitions';
export { ScraperOptions } from './scrapers/base-scraper';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}
