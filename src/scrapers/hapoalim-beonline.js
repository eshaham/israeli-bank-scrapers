/* eslint class-methods-use-this: 0 */

import HapoalimScraper from './hapoalim';

class HapoalimBeOnlineScraper extends HapoalimScraper {
  get baseUrl() {
    return 'https://login.poalimbeonline.co.il';
  }

  get portalUrl() {
    return 'bo';
  }
}

export default HapoalimBeOnlineScraper;
