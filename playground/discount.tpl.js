import moment from 'moment';
import { scrape } from './helpers/scraper';

const credentials = {
  id: '_replace_with_actual_id_',
  password: '_replace_with_actual_password_',
  num: '_replace_with_actual_num',
};

const options = {
  companyId: 'discount',
  startDate: moment('2017-08-01'),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};


(async () => {
  scrape(options, credentials);
})();