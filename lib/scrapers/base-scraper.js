import phantom from 'phantom';

import ScraperNotifier from '../helpers/notifier';
import { waitForUrls, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const LOGIN_RESULT = {
  SUCCESS: 'success',
  INVALID_PASSWORD: 'invalidPassword',
  CHANGE_PASSWORD: 'changePassword',
};

class BaseScraper {
  async initialize(scraperName, options) {
    this.options = options;
    this.notifier = new ScraperNotifier(scraperName);
    this.instance = await phantom.create();
    this.page = await this.instance.createPage();
  }

  async exit() {
    await this.instance.exit();
  }

  async login(options) {
    await this.page.open(options.loginUrl);
    await waitUntilElementFound(this.page, options.submitButtonId);

    await Promise.all(options.fields.map((field) => {
      return fillInput(this.page, field.id, field.value);
    }));

    await clickButton(this.page, options.submitButtonId);
    this.notify('logging in');

    if (options.postAction) {
      await options.postAction();
    }
  }

  async analyzeLogin(possibleUrls) {
    let loginResult;
    try {
      loginResult = await waitForUrls(this.page, possibleUrls);
    } catch (e) {
      loginResult = e.timeout ? NAVIGATION_ERRORS.TIMEOUT : NAVIGATION_ERRORS.GENERIC;
    }

    return loginResult;
  }

  async handleLoginResult(loginResult, fetchDataAction) {
    switch (loginResult) {
      case LOGIN_RESULT.SUCCESS:
        this.notify('login successful');
        return fetchDataAction(this.page, this.options);
      case LOGIN_RESULT.INVALID_PASSWORD:
        this.notify('invalid password');
        return {
          success: false,
          errorType: loginResult,
        };
      case LOGIN_RESULT.CHANGE_PASSWORD:
        this.notify('need to change password');
        return {
          success: false,
          errorType: loginResult,
        };
      case NAVIGATION_ERRORS.TIMEOUT:
        this.notify('timeout during login');
        return {
          success: false,
          errorType: loginResult,
        };
      case NAVIGATION_ERRORS.GENERIC:
        this.notify('generic error during login');
        return {
          success: false,
          errorType: loginResult,
        };
      default:
        throw new Error(`unexpected login result "${loginResult}"`);
    }
  }

  notify(msg) {
    this.notifier.notify(this.options, msg);
  }
}

export { BaseScraper, LOGIN_RESULT };
