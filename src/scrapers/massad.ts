import BeinleumiScraper, { createLoginFields, waitForPostLogin, getPossibleLoginResults } from './beinleumi';
import { ScraperCredentials } from './base-scraper';


class MassadScraper extends BeinleumiScraper {
  BASE_URL = 'https://online.bankmassad.co.il';

  LOGIN_URL = `${this.BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE`;

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;

  getLoginOptions(credentials: ScraperCredentials) {
    return {
      loginUrl: `${this.LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: '#continueBtn',
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
    };
  }
}

export default MassadScraper;
