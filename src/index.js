
import * as helpers from './helpers';
export {helpers}

import * as constants from './constants';
export {constants}

// Scrapers ( Backward Compatibility )
export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';

// Puppeteer
import puppeteerConfig from '../puppeteer-config.json';
export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

// Adapters
export * from './visa-cal';
export * from './leumi';
export * from './hapoalim';

import * as puppeteerAdapters from './puppeteer';
import runner from './runner';
import * as session from './session';

export { puppeteerAdapters, runner, session };
