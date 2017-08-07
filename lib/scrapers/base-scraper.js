import phantom from 'phantom';
import { waitForUrls, NAVIGATION_ERRORS } from '../helpers/navigation';
import { LOGIN_RESULT } from '../helpers/login';

class BaseScraper {
  async initialize() {
    this.instance = await phantom.create();
    this.page = await this.instance.createPage();
  }

  async exit() {
    await this.instance.exit();
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

export default BaseScraper;
