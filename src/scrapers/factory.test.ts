/* eslint-disable @typescript-eslint/unbound-method */
import { CompanyTypes } from '../definitions';
import createScraper from './factory';

describe('Factory', () => {
  test('should return a scraper instance', () => {
    const scraper = createScraper({
      companyId: CompanyTypes.hapoalim,
      startDate: new Date(),
    });
    expect(scraper).toBeDefined();

    expect(scraper.scrape).toBeInstanceOf(Function);
    expect(scraper.onProgress).toBeInstanceOf(Function);
  });
});
