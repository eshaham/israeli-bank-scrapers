import IsracardAmexBaseScraper from './base-isracard-amex';
import { type ScraperOptions } from './interface';

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';
const CARD_LIST_URL = 'https://web.isracard.co.il/ocp/mycards/GetCardsCarouselData';
const CARD_LIST_PAGE_URL = 'https://web.isracard.co.il/MyCards';

class IsracardScraper extends IsracardAmexBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, BASE_URL, COMPANY_CODE, CARD_LIST_URL, CARD_LIST_PAGE_URL);
  }
}

export default IsracardScraper;
