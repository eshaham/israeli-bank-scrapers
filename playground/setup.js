import inquirer from 'inquirer';
import setupCredentials from './setup-credentials';
import setupOptions from './setup-options';

(async function setup() {
  const SETUP_CREDENTIALS = 'credentials';
  const SETUP_OPTIONS = 'options';

  const { scrapeType } = await inquirer.prompt({
    type: 'list',
    name: 'scrapeType',
    message: 'What would you like to do?',
    choices: [
      {
        name: 'Setup options',
        value: SETUP_OPTIONS,
      },
      {
        name: 'Setup credentials',
        value: SETUP_CREDENTIALS,
      },
    ],
  });

  switch (scrapeType) {
    case SETUP_CREDENTIALS:
      await setupCredentials();
      break;
    case SETUP_OPTIONS:
      await setupOptions();
      break;
    default:
      break;
  }
}());
