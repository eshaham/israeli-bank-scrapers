
import * as helpers from './helpers';

import * as constants from './constants';

// Puppeteer
import puppeteerConfig from '../puppeteer-config.json';

import * as puppeteerAdapters from './puppeteer';
import runner from './runner';
import * as session from './session';

export { helpers };
export { constants };

// Scrapers ( Backward Compatibility )
export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';
export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

// Adapters
export * from './visa-cal';
export * from './leumi';
export * from './hapoalim';

export { puppeteerAdapters, runner, session };
