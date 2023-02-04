import { TimeoutError } from '../helpers/waiting';
import { createGenericError, createTimeoutError, ErrorResult } from './errors';
import type {
  TwoFactorAuthScraper,
  ScraperOptions,
  ScraperTwoFactorAuthTriggerResult,
  ScraperScrapingResult,
  ScraperGetLongTermTwoFactorTokenResult, ScraperCredentials,
} from './interface';

export type ScraperLoginResult = ErrorResult | {
  success: true;
  persistentOtpToken: string;
};


export class BaseTwoFactorAuthScraper<TTwoFactorCredentials> implements TwoFactorAuthScraper {
  constructor(protected options: ScraperOptions) {
  }

  async scrape(credentials: TTwoFactorCredentials & ScraperCredentials): Promise<ScraperScrapingResult> {
    let loginResult;
    try {
      loginResult = await this.login(credentials);
    } catch (e) {
      loginResult = e instanceof TimeoutError ?
        createTimeoutError(e.message) :
        createGenericError(e.message);
    }

    let scrapeResult;
    if (loginResult.success) {
      try {
        scrapeResult = await this.fetchData();
      } catch (e) {
        scrapeResult =
            e instanceof TimeoutError ?
              createTimeoutError(e.message) :
              createGenericError(e.message);
      }
    } else {
      scrapeResult = loginResult;
    }
    return scrapeResult;
  }

  triggerTwoFactorAuth(_phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    throw new Error(`triggerOtp() is not created in ${this.options.companyId}`);
  }

  getLongTermTwoFactorToken(_otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    throw new Error(`getPermanentOtpToken() is not created in ${this.options.companyId}`);
  }


  protected login(_credentials: TTwoFactorCredentials): Promise<ScraperLoginResult> {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  protected fetchData(): Promise<ScraperScrapingResult> {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }
}
