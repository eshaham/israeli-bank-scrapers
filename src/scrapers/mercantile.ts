import DiscountScraper from './discount';
import { ScraperCredentials } from './base-scraper';

class MercantileScraper extends DiscountScraper {
  getLoginOptions(credentials: ScraperCredentials) {
    return {
      ...super.getLoginOptions(credentials),
      loginUrl: `https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html?bank=M`,
    };
  }
}

export default MercantileScraper;
