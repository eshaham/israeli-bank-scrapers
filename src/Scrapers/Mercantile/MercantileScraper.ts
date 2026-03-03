import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import { discountConfig } from '../Discount/DiscountLoginConfig';
import DiscountScraper from '../Discount/DiscountScraper';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

class MercantileScraper extends DiscountScraper {
  constructor(options: ScraperOptions) {
    super(options, discountConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base));
  }
}

export default MercantileScraper;
