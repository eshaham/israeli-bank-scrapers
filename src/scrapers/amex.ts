import IsracardGroupScraper from './base-isracard-group';
import { type ScraperOptions } from './interface';

const LOGIN_BASE_URL = 'https://he.americanexpress.co.il';
const WEB_BASE_URL = 'https://web.americanexpress.co.il';
const COMPANY_CODE = '77';
const COMPANY_CODE_NUM = 77;

class AmexScraper extends IsracardGroupScraper {
  constructor(options: ScraperOptions) {
    super(options, LOGIN_BASE_URL, WEB_BASE_URL, COMPANY_CODE, COMPANY_CODE_NUM);
  }
}

export default AmexScraper;
