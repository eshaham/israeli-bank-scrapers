import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi].urls.base));
  }
}

export default BeinleumiScraper;
