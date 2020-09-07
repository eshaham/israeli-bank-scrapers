// Puppeteer imports
import puppeteerConfig from './puppeteer-config.json';

// Puppeteer exports
export function getPuppeteerConfig() {
  return { ...puppeteerConfig };
}

// Adapters exports
export * from './adapters';

// Scrapers exports ( Backward Compatibility )
export { default as createScraper } from './scrapers/factory';
export { SCRAPERS, CompanyTypes } from './definitions';

