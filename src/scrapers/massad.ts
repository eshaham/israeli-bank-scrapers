import BeinleumiGroupBaseScraper from './base-beinleumi-group';

class MassadScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://online.bankmassad.co.il';

  LOGIN_URL = `${this.BASE_URL}/MatafLoginService/MatafLoginServlet?bankId=MASADPRTAL&site=Private&KODSAFA=HE`;

  TRANSACTIONS_URL = `${this.BASE_URL}/wps/myportal/FibiMenu/Online/OnAccountMngment/OnBalanceTrans/PrivateAccountFlow`;
}

export default MassadScraper;
