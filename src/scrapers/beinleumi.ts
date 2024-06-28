import BeinleumiGroupBaseScraper from './base-beinleumi-group';

class BeinleumiScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.fibi.co.il';

  LOGIN_URL = `${this.BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

export default BeinleumiScraper;
