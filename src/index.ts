import puppeteerConfig from './puppeteer-config.json';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS, CompanyTypes } from './definitions';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}
