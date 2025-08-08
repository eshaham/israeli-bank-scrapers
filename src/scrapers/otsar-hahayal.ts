import BeinleumiGroupBaseScraper from './base-beinleumi-group';

class OtsarHahayalScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankotsar.co.il';

  LOGIN_URL = `${this.BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=OTSARPRTAL&site=Private&KODSAFA=HE`;

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

export default OtsarHahayalScraper;
