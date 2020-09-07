import {
  maybeTestCompanyAPI, extendAsyncTimeout, getTestsConfig,
} from '../../tests/tests-utils';
import {loginAdapter} from './login';
import { runner } from '@core/runner';
import { LOGIN_RESULT } from '../../constants';

const COMPANY_ID = 'visaCal';
const testsConfig = getTestsConfig();

describe('VisaCal login', () => {
  beforeAll(() => {
    extendAsyncTimeout(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });

  maybeTestCompanyAPI(COMPANY_ID,
      (testsConfig) => {
        return testsConfig.companyAPI['invalidLogin'];
      })('should fail on invalid credentials"', async () => {
    const {
      onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      loginAdapter({
        credentials: { username: 'e10s12', password: '3f3ss3d' },
      }),
    ];

    const result = await runner(runnerOptions, runnerAdapters);

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(LOGIN_RESULT.INVALID_PASSWORD);
  });

  maybeTestCompanyAPI(COMPANY_ID, (testsConfig) => {
    return testsConfig.companyAPI['login'];
  })('should login successfully', async () => {
    const {
      onProgress,
    } = testsConfig.options;

    const runnerOptions = {
      onProgress,
    };

    const runnerAdapters = [
      loginAdapter({
        credentials: testsConfig.credentials.visaCal,
      }),
    ];

    const result = await runner(runnerOptions, runnerAdapters);
    expect(result.success).toBe(true);
  });
});
