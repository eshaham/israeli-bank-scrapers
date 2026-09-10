import IsracardGroupScraper from './base-isracard-group';
import { type ScraperOptions } from './interface';

const LOGIN_BASE_URL = 'https://digital.isracard.co.il';
const WEB_BASE_URL = 'https://web.isracard.co.il';
const COMPANY_CODE = '11';
const COMPANY_CODE_NUM = 11;

class IsracardScraper extends IsracardGroupScraper {
  constructor(options: ScraperOptions) {
    super(options, LOGIN_BASE_URL, WEB_BASE_URL, COMPANY_CODE, COMPANY_CODE_NUM);
  }
}

export default IsracardScraper;
