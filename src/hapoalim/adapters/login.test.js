import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
} from '../../../tests/tests-utils';
import { createBrowserAdapter, createBrowserPageAdapter, closeBrowserAdapter } from '../../core/adapters/puppeteer';
import loginAdapter from './login';
import runner from '../../core/runner';
import { LOGIN_RESULT } from '../../constants';

const COMPANY_ID = 'hapoalim';
const testsConfig = getTestsConfig();

describe('Hapoalim login', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID, 'invalidLogin')('should fail on invalid credentials"', async () => {
    const {
      verbose, showBrowser, onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      createBrowserAdapter({
        verbose,
        showBrowser,
      }),
      createBrowserPageAdapter(),
      loginAdapter({
        credentials: { username: 'e10s12', password: '3f3ss3d' },
      }),
    ];

    const cleanupAdapters = [
      closeBrowserAdapter(),
    ];

    const result = await runner(runnerOptions, runnerAdapters, cleanupAdapters);

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(LOGIN_RESULT.INVALID_PASSWORD);
  });

  maybeTestCompanyAPI(COMPANY_ID, 'login')('should login successfully', async () => {
    const {
      verbose, showBrowser, onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      createBrowserAdapter({
        verbose,
        showBrowser,
      }),
      createBrowserPageAdapter(),
      loginAdapter({
        credentials: testsConfig.credentials.hapoalim,
      }),
    ];

    const cleanupAdapters = [
      closeBrowserAdapter(),
    ];

    const result = await runner(runnerOptions, runnerAdapters, cleanupAdapters);

    expect(result.success).toBe(true);
  });
});
