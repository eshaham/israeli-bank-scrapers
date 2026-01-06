import moment from 'moment';
// import { getDebug } from '../helpers/debug';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../transactions'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { BaseScraperWithBrowser } from './base-scraper-with-browser';
import { ScraperErrorTypes } from './errors';
import { sleep } from '../helpers/waiting';
import { waitForNavigation } from '../helpers/navigation';

// const debug = getDebug('cibus');
const debug = console.log;
const LOGIN_URL = 'https://consumers.pluxee.co.il/login';

function parseSetCookieHeader(cookieHeader: string) {
  const parts = cookieHeader.split(';').map(part => part.trim());
  const [nameValue] = parts;
  const [name, value] = nameValue.split('=');

  const cookie: any = { name, value };

  for (let i = 1; i < parts.length; i++) {
    const [key, val] = parts[i].split('=');
    const lowerKey = key.toLowerCase();

    switch (lowerKey) {
      case 'domain':
        cookie.domain = val.startsWith('.') ? val : `.${val}`;
        break;
      case 'path':
        cookie.path = val;
        break;
      case 'expires':
        cookie.expires = new Date(val).getTime() / 1000; // Convert to Unix timestamp
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite':
        cookie.sameSite = val as 'Strict' | 'Lax' | 'None';
        break;
    }
  }

  return cookie;
}

type ScraperSpecificCredentials = { username: string; password: string; company: string; cookie?: string };

class CibusScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  async login(credentials: ScraperSpecificCredentials) {
    await this.navigateTo(LOGIN_URL);

    // If cookie is provided, set cookies from credentials
    if (credentials.cookie) {
      console.log('Setting cookies from credentials');
      const cookiesStrings = credentials.cookie.split('%%--%%');

      for (const cookie of cookiesStrings) {
        await this.page.setCookie(parseSetCookieHeader(cookie));
      }
    }

    try {
      // 1) Type username
      await this.page.waitForSelector('#user', { visible: true });
      await this.page.type('#user', credentials.username);

      // 2) Blur username so the form state updates
      await this.page.keyboard.press('Tab'); // or:
      // await this.page.$eval('#user', el => (el as HTMLInputElement).blur());

      // 3) Wait a bit or for visible button
      await this.page.waitForSelector('.login-btn-container .cib-btn.cib-pink-grad', {
        visible: true,
      });

      // 4) Click via page.evaluate (bypasses clickablePoint)
      await this.page.evaluate(() => {
        const btn = document.querySelector('.login-btn-container .cib-btn.cib-pink-grad');
        if (!btn) throw new Error('Continue button not found');
        (btn as HTMLElement).click();
      });

      await this.page.waitForSelector('#password');
      await this.page.type('#password', credentials.password);

      await this.page.waitForSelector('#company-inp');
      await this.page.type('#company-inp', credentials.company);

      // 4) Click via page.evaluate (bypasses clickablePoint)
      await this.page.evaluate(() => {
        const btn = document.querySelector('.login-btn-container .cib-btn.cib-pink-grad');
        if (!btn) throw new Error('Continue button not found');
        (btn as HTMLElement).click();
      });

      await waitForNavigation(this.page);

      if (this.isLoginSucceeded()) {
        debug('Login succeeded');
        return { success: true };
      }
      debug('Login not succeeded, checking for OTP...');
      debug('Current URL:', this.page.url());
      if (await this.isOtpRequired()) {
        debug('OTP required - not supported');
        return {
          success: false,
          errorType: ScraperErrorTypes.TwoFactorRetrieverMissing,
          errorMessage: 'OTP required - not supported',
        };
      }
      debug('OTP not detected, assuming invalid password');
      return {
        success: false,
        errorType: ScraperErrorTypes.InvalidPassword,
        errorMessage: 'Login failed',
      };
    } catch (e) {
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: `Login error: ${(e as Error).message}`,
      };
    }
  }

  private isLoginSucceeded(): boolean {
    const currentUrl = this.page.url();
    debug('Checking login success by verifying URL changed from login page');
    debug('Current URL:', currentUrl);
    if (currentUrl !== LOGIN_URL) {
      debug('Login succeeded - navigated away from login page');
      return true;
    }
    debug('Login did not succeed - still on login page');
    return false;
  }

  async isOtpRequired(): Promise<boolean> {
    try {
      debug('Waiting for OTP container...');
      await this.page.waitForSelector('.otp-container', { timeout: 5000 });
      debug('OTP container found');
      return true;
    } catch {
      debug('OTP container not found within 5 seconds');
      // Let's also check what elements are present that might indicate OTP
      try {
        const otpElements = await this.page.$$('[class*="otp"], [id*="otp"], input[type="tel"], .verification');
        debug(`Found ${otpElements.length} potential OTP-related elements`);
        if (otpElements.length > 0) {
          for (let i = 0; i < Math.min(otpElements.length, 3); i++) {
            const el = otpElements[i];
            const tagName = await el.evaluate(e => e.tagName);
            const className = await el.evaluate(e => e.className);
            const id = await el.evaluate(e => e.id);
            debug(`OTP element ${i}: ${tagName} class="${className}" id="${id}"`);
          }
        }
      } catch (e) {
        debug('Error checking for OTP elements:', (e as Error).message);
      }
      return false;
    }
  }

  async fetchData() {
    debug('Fetching Cibus transaction data');
    console.log('Fetching Cibus transaction data');

    try {
      await sleep(5000);

      await this.navigateTo('https://consumers.pluxee.co.il/user/orders');

      // Get cookies to extract the token
      const cookies = await this.page.cookies();
      debug(
        'All cookies:',
        cookies.map(c => ({ name: c.name, value: c.value.substring(0, 20) + '...' })),
      );

      const tokenCookie = cookies.find(cookie => cookie.name === 'token');
      if (!tokenCookie) {
        debug('Token cookie not found among cookies');
        throw new Error('Token cookie not found');
      }

      const token = tokenCookie.value;
      debug(`Found token: ${token.substring(0, 20)}...`);

      // Make API call to fetch transactions
      const apiUrl = 'https://api.consumers.pluxee.co.il/api/main.py';
      const startDate = moment(this.options.startDate).format('DD/MM/YYYY');
      const calculatedEndDate = moment(this.options.startDate).add(this.options.futureMonthsToScrape || 2, 'months');
      const today = moment();
      const endDate = calculatedEndDate.isAfter(today)
        ? today.format('DD/MM/YYYY')
        : calculatedEndDate.format('DD/MM/YYYY');
      const requestBody = {
        from_date: startDate,
        to_date: endDate,
        type: 'prx_user_deals',
      };

      debug(`Making API request to ${apiUrl} with body:`, requestBody);

      const headers = {
        'application-id': 'E5D5FEF5-A05E-4C64-AEBA-BA0CECA0E402',
        Cookie: `token=${token}`,
        'Content-Type': 'application/json',
      };
      debug('Headers being sent:', headers);

      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!apiResponse.ok) {
        throw new Error(`API request failed with status ${apiResponse.status}: ${apiResponse.statusText}`);
      }

      const responseJson = await apiResponse.json();

      // Parse the response and convert to transactions
      const allTransactions: Transaction[] = this.parseTransactions(responseJson);

      const accounts = [
        {
          accountNumber: 'cibus-account',
          txns: allTransactions,
        },
      ];

      return {
        success: true,
        accounts,
      };
    } catch (error) {
      debug('Error fetching Cibus data:', error);
      return {
        success: false,
        errorType: ScraperErrorTypes.General,
        errorMessage: `Failed to fetch transaction data: ${(error as Error).message}`,
      };
    }
  }

  private parseTransactions(apiResponse: any): Transaction[] {
    const transactions: Transaction[] = [];

    // debug('Parsing API response:', apiResponse);

    if (apiResponse && apiResponse.list && Array.isArray(apiResponse.list)) {
      for (const item of apiResponse.list) {
        // Skip undefined or null items
        if (!item || typeof item !== 'object') {
          debug('Skipping invalid item:', item);
          continue;
        }
        // Skip items with missing required fields
        if (!item.date || !item.time || !item.rest_name || !item.deal_id) {
          debug('Skipping item with missing fields:', item);
          continue;
        }

        // Parse date from DD/MM/YYYY format
        const dateParts = item.date.split('/');
        if (dateParts.length !== 3) {
          debug('Invalid date format:', item.date);
          continue;
        }
        const isoDate = `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`;

        // Combine date and time for processedDate
        const processedDate = moment(`${item.date} ${item.time}`, 'DD/MM/YYYY HH:mm').toISOString();

        let description = item.rest_name;
        if (item.voucher_code) {
          description += ` (Voucher: ${item.voucher_code})`;
        }

        // Handle company price as income (positive)
        if (item.etc_company_price && item.etc_company_price > 0) {
          const companyTransaction: Transaction = {
            type: TransactionTypes.Normal,
            identifier: `${item.deal_id}_company`,
            date: isoDate,
            processedDate,
            originalAmount: item.etc_company_price,
            originalCurrency: 'ILS',
            chargedAmount: item.etc_company_price,
            chargedCurrency: 'ILS',
            description: `${description} - Company contribution`,
            status: TransactionStatuses.Completed,
            category: 'משכורת',
          };
          transactions.push(companyTransaction);
        }

        // Handle employee price as expense (negative)
        if (item.etc_employee_price && item.etc_employee_price > 0) {
          const employeeTransaction: Transaction = {
            type: TransactionTypes.Normal,
            identifier: `${item.deal_id}_employee`,
            date: isoDate,
            processedDate,
            originalAmount: -Math.abs(item.etc_employee_price),
            originalCurrency: 'ILS',
            chargedAmount: -Math.abs(item.etc_employee_price),
            chargedCurrency: 'ILS',
            description: `${description} - Employee payment`,
            status: TransactionStatuses.Completed,
            category: description.includes('voucher') ? 'קניות מזון' : 'אוכל בחוץ',
          };
          transactions.push(employeeTransaction);
        }
      }
    }

    return transactions;
  }
}

export default CibusScraper;
