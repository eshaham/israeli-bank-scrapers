import DiscountScraper from './discount';

type ScraperSpecificCredentials = { id: string; password: string; num: string };
class MercantileScraper extends DiscountScraper {
  getLoginOptions(credentials: ScraperSpecificCredentials) {
    return {
      ...super.getLoginOptions(credentials),
      loginUrl: 'https://start.telebank.co.il/login/?bank=m',
    };
  }
}

export default MercantileScraper;
