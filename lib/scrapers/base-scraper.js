import phantom from 'phantom';
import { waitForUrls, NAVIGATION_ERRORS } from '../helpers/navigation';
import { waitUntilElementFound, fillInput, clickButton } from '../helpers/elements-interactions';

const LOGIN_RESULT = {
  SUCCESS: 'success',
  INVALID_PASSWORD: 'invalidPassword',
  CHANGE_PASSWORD: 'changePassword',
};

class BaseScraper {
  async initialize() {
    this.instance = await phantom.create();
    this.page = await this.instance.createPage();
  }

  async exit() {
    await this.instance.exit();
  }

  async login(loginUrl, fields, submitButtonId, options, notifier) {
    await this.page.open(loginUrl);
    await waitUntilElementFound(this.page, submitButtonId);

    await Promise.all(fields.map((field) => {
      return fillInput(this.page, field.id, field.value);
    }));

    await clickButton(this.page, submitButtonId);
    notifier.notify(options, 'logging in');
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

  async handleLoginResult(options, loginResult, notifier, fetchDataAction) {
    switch (loginResult) {
      case LOGIN_RESULT.SUCCESS:
        notifier.notify(options, 'login successful');
        return fetchDataAction(this.page, options);
      case LOGIN_RESULT.INVALID_PASSWORD:
        notifier.notify(options, 'invalid password');
        return {
          success: false,
          errorType: loginResult,
        };
      case LOGIN_RESULT.CHANGE_PASSWORD:
        notifier.notify(options, 'need to change password');
        return {
          success: false,
          errorType: loginResult,
        };
      case NAVIGATION_ERRORS.TIMEOUT:
        notifier.notify(options, 'timeout during login');
        return {
          success: false,
          errorType: loginResult,
        };
      case NAVIGATION_ERRORS.GENERIC:
        notifier.notify(options, 'generic error during login');
        return {
          success: false,
          errorType: loginResult,
        };
      default:
        throw new Error(`unexpected login result "${loginResult}"`);
    }
  }
}

export { BaseScraper, LOGIN_RESULT };
