import moment from 'moment-timezone';
import BeinleumiGroupBaseScraper from './base-beinleumi-group';
import { attachAssets } from './beinleumi-assets';
import { readAssets } from './beinleumi-assets-browser';

class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  async fetchData() {
    if (!this.options.optInFeatures?.includes('beinleumi:assets')) return super.fetchData();
    // Capture the selected account before transaction scraping changes navigation.
    const snapshot = await readAssets(this.page);
    const result = await super.fetchData();
    return {
      ...result,
      accounts: attachAssets(result.accounts || [], snapshot, moment().tz('Asia/Jerusalem').format('YYYY-MM-DD')),
    };
  }

  BASE_URL = 'https://online.fibi.co.il';

  LOGIN_URL = `${this.BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

export default BeinleumiScraper;
