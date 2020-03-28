// Global imports
import * as helpers from './helpers';
import * as constants from './constants';

// Puppeteer imports
import puppeteerConfig from './puppeteer-config.json';

// Global exports
export { helpers };
export { constants };

// Puppeteer exports
export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

// Adapters exports
export * from './core';

// Companies adapters exports
export * from './visa-cal';
export * from './leumi';
export * from './hapoalim';

// Scrapers exports ( Backward Compatibility )
export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';

