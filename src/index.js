import puppeteerConfig from '../puppeteer-config.json';
export * from './adapters/public-api';
import * as helpers from './helpers';

export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';

export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

export {helpers}
