import { getDebug } from '../helpers/debug';
import IsracardAmexBaseScraper from './base-isracard-amex';
import { ScraperErrorTypes } from './errors';
import { type ScraperOptions, type ScraperScrapingResult } from './interface';
import IsracardXlsxScraper from './isracard-xlsx-scraper';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

const debug = getDebug('isracard');

type ScraperSpecificCredentials = { id: string; password: string; card6Digits: string };

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }

  async scrape(credentials: ScraperSpecificCredentials): Promise<ScraperScrapingResult> {
    const result = await super.scrape(credentials);
    if (result.success) return result;

    // Don't fallback on auth errors - credentials are wrong
    if (result.errorType === ScraperErrorTypes.InvalidPassword) return result;

    // WAF block or transient error → try XLSX fallback
    debug(`primary scrape failed (${result.errorType}: ${result.errorMessage}), trying XLSX fallback`);

    const xlsxScraper = new IsracardXlsxScraper(this.options);
    return xlsxScraper.scrape(credentials);
  }
}

export default IsracardScraper;
