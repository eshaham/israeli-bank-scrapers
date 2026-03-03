import { CompanyTypes } from '../../Definitions';
import { type LoginConfig } from '../Base/LoginConfig';
import { beinleumiConfig } from '../BaseBeinleumiGroup/BeinleumiLoginConfig';
import { BEHATSDAA_CONFIG } from '../Behatsdaa/BehatsdaaLoginConfig';
import { BEYAHAD_CONFIG } from '../BeyahadBishvilha/BeyahadBishvilhaLoginConfig';
import { discountConfig } from '../Discount/DiscountLoginConfig';
import { HAPOALIM_CONFIG } from '../Hapoalim/HapoalimLoginConfig';
import { LEUMI_CONFIG } from '../Leumi/LeumiLoginConfig';
import { MAX_CONFIG } from '../Max/MaxLoginConfig';
import { MIZRAHI_CONFIG } from '../Mizrahi/MizrahiLoginConfig';
import { YAHAV_CONFIG } from '../Yahav/YahavLoginConfig';
import { SCRAPER_CONFIGURATION } from './ScraperConfig';

export const BANK_REGISTRY: Partial<Record<CompanyTypes, LoginConfig>> = {
  [CompanyTypes.Beinleumi]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Beinleumi].urls.base,
  ),
  [CompanyTypes.OtsarHahayal]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.OtsarHahayal].urls.base,
  ),
  [CompanyTypes.Massad]: beinleumiConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Massad].urls.base,
  ),
  [CompanyTypes.Pagi]: beinleumiConfig(SCRAPER_CONFIGURATION.banks[CompanyTypes.Pagi].urls.base),
  [CompanyTypes.Discount]: discountConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount].urls.base,
  ),
  [CompanyTypes.Mercantile]: discountConfig(
    SCRAPER_CONFIGURATION.banks[CompanyTypes.Mercantile].urls.base,
  ),
  [CompanyTypes.Hapoalim]: HAPOALIM_CONFIG,
  [CompanyTypes.Leumi]: LEUMI_CONFIG,
  [CompanyTypes.Mizrahi]: MIZRAHI_CONFIG,
  [CompanyTypes.Max]: MAX_CONFIG,
  [CompanyTypes.Behatsdaa]: BEHATSDAA_CONFIG,
  [CompanyTypes.BeyahadBishvilha]: BEYAHAD_CONFIG,
  [CompanyTypes.Yahav]: YAHAV_CONFIG,
};
