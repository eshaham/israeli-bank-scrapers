import moment from 'moment';
import { scrape } from './helpers/scraper';

const credentials = {
  username: '_replace_with_actual_user',
  password: '_replace_with_actual_password',
};

const options = {
  companyId: 'leumi',
  startDate: moment('2017-08-01'),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};


(async () => {
  scrape(options, credentials);
})();