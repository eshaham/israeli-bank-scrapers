import puppeteerConfig from '../puppeteer-config';
import * as adapters from './adapters/public-api';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

export { adapters };
