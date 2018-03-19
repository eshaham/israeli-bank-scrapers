import moment from 'moment';
import { scrape } from './helpers/scraper';

const credentials = {
  id: '_replace_with_actual_id',
  card6Digits: '_replace_with_actual_card6Digits',
  password: '_replace_with_actual_password',
};

const options = {
  companyId: 'isracard',
  startDate: moment('2017-08-01'),
  combineInstallments: false,
  showBrowser: true,
  verbose: true,
};


(async () => {
  scrape(options, credentials);
})();