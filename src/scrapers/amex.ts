import IsracardAmexBaseScraper from './base-isracard-amex';
import { BaseScraperOptions } from './base-scraper';

const BASE_URL = 'https://he.americanexpress.co.il';
const COMPANY_CODE = '77';

class AmexScraper extends IsracardAmexBaseScraper {
  constructor(options: BaseScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE);
  }
}

export default AmexScraper;
