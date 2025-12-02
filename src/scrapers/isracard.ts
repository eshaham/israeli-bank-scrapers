import debug from 'debug';
import IsracardAmexBaseScraper from './base-isracard-amex';
import { type ScraperOptions } from './interface';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

debug.enable('israeli-bank-scrapers:base-isracard-amex');

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default IsracardScraper;
