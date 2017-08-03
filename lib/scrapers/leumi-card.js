import phantom from 'phantom';

import { login as performLogin, analyzeLogin, LOGIN_RESULT } from '../helpers/login';
import { waitForRedirect } from '../helpers/navigation';
import { waitUntilElementFound } from '../helpers/elements-interactions';

const BASE_URL = 'https://online.leumi-card.co.il';

function notify(options, message) {
  if (options.eventsCallback) {
    options.eventsCallback(message);
  }
}

async function login(page, credentials, options) {
  const loginUrl = `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`;
  const inputGroupName = 'PlaceHolderMain_CardHoldersLogin1';
  const loginFields = [
    { id: `${inputGroupName}_txtUserName`, value: credentials.username },
    { id: `${inputGroupName}_txtPassword`, value: credentials.password },
  ];
  await performLogin(page, loginUrl, loginFields, `${inputGroupName}_btnLogin`, () => notify(options, 'leumi card: logging in'));
}

function redirectOrDialog(page) {
  return Promise.race([
    waitForRedirect(page),
    waitUntilElementFound(page, 'popupWrongDetails', true),
  ]);
}

async function handleLoginResult(page, options, loginResult) {
  let scrapeResult;
  switch (loginResult) {
    case LOGIN_RESULT.SUCCESS:
      notify(options, 'leumi card: login successful');
      scrapeResult = {
        success: true,
      };
      break;
    case LOGIN_RESULT.INVALID_PASSWORD:
      notify(options, 'leumi card: invalid password');
      scrapeResult = {
        success: false,
        errorType: loginResult,
      };
      break;
    default:
      throw new Error(`unexpected login result "${loginResult}"`);
  }

  return scrapeResult;
}

function getPossibleLoginUrls() {
  const urls = {};
  urls[LOGIN_RESULT.SUCCESS] = `${BASE_URL}/Registred/HomePage.aspx`;
  urls[LOGIN_RESULT.INVALID_PASSWORD] = `${BASE_URL}/Anonymous/Login/CardHoldersLogin.aspx`;
  return urls;
}

async function scrape(credentials, options = {}) {
  notify(options, 'leumi card: start scraping');

  const instance = await phantom.create();
  const page = await instance.createPage();

  await login(page, credentials, options);
  await redirectOrDialog(page);

  const loginResult = await analyzeLogin(page, getPossibleLoginUrls());
  if (['timeout', 'generic'].includes(loginResult)) {
    await instance.exit();
    return {
      success: false,
      errorType: loginResult,
    };
  }

  const scrapeResult = await handleLoginResult(page, options, loginResult);

  await instance.exit();

  return scrapeResult;
}

export default scrape;
