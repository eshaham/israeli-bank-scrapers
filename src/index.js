export { default as createScraper } from './scrapers/factory';
export { SCRAPERS } from './definitions';
import { PUPPETEER_REVISIONS } from 'puppeteer';

export function getPuppeteerConfig() {
  return {
    chromiumRevision: PUPPETEER_REVISIONS.chromium
  };
}
