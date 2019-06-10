import puppeteer from 'puppeteer';
import fs from 'fs';
import {
  waitUntilElementFound,
  clickButton,
} from '../helpers/elements-interactions';
import { askQuestion } from '../helpers/waiting';
import { waitForRedirect } from '../helpers/navigation';
import { addMonths } from '../helpers/dates';
import { fetchAccountData } from './poalim-business/helpers';
import { SCRAPE_PROGRESS_TYPES } from '../constants';
import { BaseScraper } from './base-scraper';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

const BASE_URL = 'https://biz2.bankhapoalim.co.il/authenticate/logon/main';

class HapoalimBusinessScraper extends BaseScraper {
  async initialize() {
    this.browser = await puppeteer.launch({ headless: true });

    this.page = await this.browser.newPage();

    await this.page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });

    await this.page.goto(BASE_URL);
  }

  async login(credentials) {
    await this.page.goto(BASE_URL);

    const USER_ID_INPUT = '#userID';
    const PASSWORD_INPUT = '#userPassword';

    const submitButtonSelector = '#inputSend';
    const loginOptions = {
      submitButtonSelector,
      credentials,
    };

    await waitUntilElementFound(this.page, loginOptions.submitButtonSelector);

    await this.page.type(USER_ID_INPUT, credentials.userCode);
    await this.page.type(PASSWORD_INPUT, credentials.password);

    // const fields = createLoginFields(loginOptions.credentials),

    // await fillInputs(page, fields);

    await clickButton(this.page, loginOptions.submitButtonSelector);

    const code = await askQuestion("What's the code?");

    await this.page.type('#codeForOtp', code);

    await this.page.keyboard.press('Enter');
    await clickButton(this.page, '#buttonNo');

    await waitForRedirect(this.page);

    this.emitProgress(SCRAPE_PROGRESS_TYPES.LOGIN_SUCCESS);
    return { success: true };
  }

  async fetchData() {
    const options = {
      companyId: 'hapoalim',
      startDate: addMonths(new Date(), -12),
    };
    const result = await fetchAccountData(this.page, options);

    const date = new Date();
    const dateString = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
      .toISOString()
      .split('T')[0];
    fs.writeFile(`./old_data/POALIM_data_${dateString}.json`, JSON.stringify(result), 'utf8', () => {
      console.log('done dumping NIS file');
    });

    return result;
  }

  async terminate() {
    this.emitProgress(SCRAPE_PROGRESS_TYPES.TERMINATING);
    await this.browser.close();
  }
}

export default HapoalimBusinessScraper;
