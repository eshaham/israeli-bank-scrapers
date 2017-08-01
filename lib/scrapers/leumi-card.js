import phantom from 'phantom';

import { login as performLogin } from '../helpers/login';

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

async function scrape(credentials, options = {}) {
  notify(options, 'leumi card: start scraping');

  const instance = await phantom.create();
  const page = await instance.createPage();

  await login(page, credentials, options);

  await instance.exit();

  const accountData = {
    success: true,
  };

  return accountData;
}

export default scrape;
