import IsracardAmexBaseScraper from './base-isracard-amex';
import { type ScraperOptions } from './interface';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default IsracardScraper;
