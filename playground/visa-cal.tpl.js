import moment from 'moment';
import { scrape } from './helpers/scraper';

const credentials = {
  username: '_replace_with_actual_user_',
  password: '_replace_with_actual_password_',
};

const options = {
  companyId: 'visaCal',
  startDate: moment('2017-08-01'),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};


(async () => {
  scrape(options, credentials);
})();