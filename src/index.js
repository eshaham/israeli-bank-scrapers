import puppeteerConfig from './puppeteer-config';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';

export function getPuppeteerConfig() {
  return Object.assign({}, puppeteerConfig);
}
