import { type Page } from 'puppeteer';
import { pageEvalAll, waitUntilElementFound } from '../helpers/elements-interactions';
import { type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult } from './interface';

/*
* BitsofGold Scraper - Cryptocurrency Platform
*/

const LOGIN_URL = 'https://www.bitsofgold.co.il/';

async function checkErrorMessage(page: Page) {
  return pageEvalAll(
    page,
    '.error-message, .alert-danger, [class*="error"]',
    '',
    element => (element[0] as HTMLElement)?.innerText,
  );
}

function getPossibleLoginResults() {
  const urls: LoginOptions['possibleResults'] = {
    [LoginResults.Success]: [
      /profile\/wallet|dashboard|account|portfolio/i,
      async options => {
        if (!options?.page) throw new Error('missing page options argument');
        try {
          const balanceElement = await options.page.$('.total-spent.d-flex.align-items-center.single span');
          if (balanceElement) return true;
          const successElements = await options.page.$$('[href*="profile"], [href*="wallet"], .portfolio');
          return successElements.length > 0;
        } catch {
          return false;
        }
      },
    ],
    [LoginResults.InvalidPassword]: [
      async options => {
        if (!options?.page) throw new Error('missing page options argument');
        const msg = await checkErrorMessage(options.page);
        return msg?.includes('שם משתמש או סיסמה שגויים') || msg?.includes('invalid') || msg?.includes('שגוי') || false;
      },
    ],
    [LoginResults.AccountBlocked]: [
      async options => {
        if (!options?.page) throw new Error('missing page options argument');
        const msg = await checkErrorMessage(options.page);
        return msg?.includes('המשתמש חסום') || msg?.includes('חסום') || false;
      },
    ],
  };
  return urls;
}

function createLoginFields(credentials: ScraperSpecificCredentials) {
  return [
    {
      selector:
        'input[type="email"], input[name="email"], input[name="username"], input[placeholder*="מייל"], input[placeholder*="email"], input[placeholder*="משתמש"]',
      value: credentials.username,
    },
    {
      selector:
        'input[type="password"], input[name="password"], input[placeholder*="סיסמה"], input[placeholder*="password"]',
      value: credentials.password,
    },
  ];
}

async function navigateToLogin(page: Page): Promise<void> {
  try {
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 });
  } catch {
    // Continue if network idle fails
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  await page.click('img[src*="avatar-nofill.svg"]');
  await waitUntilElementFound(
    page,
    'input[type="email"], input[name="email"], input[placeholder*="מייל"]',
    true,
    10000,
  );
}

async function waitForPostLogin(page: Page): Promise<void> {
  await Promise.race([
    waitUntilElementFound(page, '[href*="profile"], [href*="wallet"], [href*="dashboard"]', true, 15000),
    waitUntilElementFound(page, '.portfolio, .wallet, .account-summary', true, 15000),
    page.waitForSelector('.error-message, .alert-danger, [class*="error"]', { timeout: 10000 }),
  ]).catch(() => {
    // Continue even if no clear indicator found
  });
}

async function extractBalance(page: Page): Promise<TransactionsAccount> {
  try {
    await waitUntilElementFound(page, '.total-spent.d-flex.align-items-center.single span', true, 5000);
    const balance = await page.evaluate(() => {
      const balanceElement = document.querySelector('.total-spent.d-flex.align-items-center.single span');
      if (balanceElement) {
        const balanceText = balanceElement.textContent?.trim() || '';
        const numberMatch = balanceText.match(/[\d,]+\.?\d*/);
        if (numberMatch) {
          return parseFloat(numberMatch[0].replace(/,/g, ''));
        }
      }
      return undefined;
    });

    return {
      accountNumber: 'bitsofgold-crypto-wallet',
      balance,
      txns: [], // BitsofGold does not support transaction history
    };
  } catch (error) {
    return {
      accountNumber: 'bitsofgold-crypto-wallet',
      txns: [],
    };
  }
}

type ScraperSpecificCredentials = { username: string; password: string };

class BitsofGoldScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"], .submit-btn, .login-btn, input[type="submit"]',
      checkReadiness: async () => navigateToLogin(this.page),
      postAction: async () => waitForPostLogin(this.page),
      possibleResults: getPossibleLoginResults(),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    try {
      const account = await extractBalance(this.page);
      return {
        success: true,
        accounts: [account],
      };
    } catch (error) {
      return {
        success: false,
        errorType: 'generic' as any,
        errorMessage: `Failed to fetch balance: ${(error as Error).message}`,
      };
    }
  }
}

export default BitsofGoldScraper;
