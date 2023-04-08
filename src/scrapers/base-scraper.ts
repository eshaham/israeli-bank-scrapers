import { EventEmitter } from 'events';
import moment from 'moment-timezone';
import { TimeoutError } from '../helpers/waiting';
import { createGenericError, createTimeoutError } from './errors';
import {
  Scraper,
  ScraperCredentials,
  ScraperGetLongTermTwoFactorTokenResult,
  ScraperLoginResult,
  ScraperOptions,
  ScraperScrapingResult,
  ScraperTwoFactorAuthTriggerResult,
} from './interface';

const SCRAPE_PROGRESS = 'SCRAPE_PROGRESS';


export enum ScraperProgressTypes {
  Initializing = 'INITIALIZING',
  StartScraping = 'START_SCRAPING',
  LoggingIn = 'LOGGING_IN',
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailed = 'LOGIN_FAILED',
  ChangePassword = 'CHANGE_PASSWORD',
  EndScraping = 'END_SCRAPING',
  Terminating = 'TERMINATING',
}

export class BaseScraper<TCredentials extends ScraperCredentials> implements Scraper<TCredentials> {
  private eventEmitter = new EventEmitter();

  constructor(public options: ScraperOptions) {
  }

  // eslint-disable-next-line  @typescript-eslint/require-await
  async initialize() {
    this.emitProgress(ScraperProgressTypes.Initializing);
    moment.tz.setDefault('Asia/Jerusalem');
  }

  async scrape(credentials: TCredentials): Promise<ScraperScrapingResult> {
    this.emitProgress(ScraperProgressTypes.StartScraping);
    await this.initialize();

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

    try {
      const success = scrapeResult && scrapeResult.success === true;
      await this.terminate(success);
    } catch (e) {
      scrapeResult = createGenericError(e.message);
    }
    this.emitProgress(ScraperProgressTypes.EndScraping);

    return scrapeResult;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  triggerTwoFactorAuth(_phoneNumber: string): Promise<ScraperTwoFactorAuthTriggerResult> {
    throw new Error(`triggerOtp() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  getLongTermTwoFactorToken(_otpCode: string): Promise<ScraperGetLongTermTwoFactorTokenResult> {
    throw new Error(`getPermanentOtpToken() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async login(_credentials: TCredentials): Promise<ScraperLoginResult> {
    throw new Error(`login() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line  @typescript-eslint/require-await
  async fetchData(): Promise<ScraperScrapingResult> {
    throw new Error(`fetchData() is not created in ${this.options.companyId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async terminate(_success: boolean) {
    this.emitProgress(ScraperProgressTypes.Terminating);
  }

  emitProgress(type: ScraperProgressTypes) {
    this.emit(SCRAPE_PROGRESS, { type });
  }

  emit(eventName: string, payload: Record<string, any>) {
    this.eventEmitter.emit(eventName, this.options.companyId, payload);
  }

  onProgress(func: (...args: any[]) => void) {
    this.eventEmitter.on(SCRAPE_PROGRESS, func);
  }
}
