import moment from 'moment';
import { scrape } from './helpers/scraper';

const credentials = {
  userCode: '_replace_with_actual_userCode_',
  password: '_replace_with_actual_password_',
};

const options = {
  companyId: 'hapoalim',
  startDate: moment('2017-08-01'),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};


(async () => {
  scrape(options, credentials);
})();