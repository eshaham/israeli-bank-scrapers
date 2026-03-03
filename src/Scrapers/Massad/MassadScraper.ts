import { CompanyTypes } from '../../Definitions';
import { type ScraperOptions } from '../Base/Interface';
import BeinleumiGroupBaseScraper from '../BaseBeinleumiGroup/BaseBeinleumiGroup';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { SCRAPER_CONFIGURATION } from '../Registry/ScraperConfig';

class MassadScraper extends BeinleumiGroupBaseScraper {
  constructor(options: ScraperOptions) {
    super(options, beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Massad].urls.base));
  }
}

export default MassadScraper;
