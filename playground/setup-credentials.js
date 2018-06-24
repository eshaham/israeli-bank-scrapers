import inquirer from 'inquirer';
import { PASSWORD_FIELD, SCRAPERS } from '../src/definitions';
import { writeJsonFile } from './helpers/files';
import { encryptCredentials } from './helpers/credentials';
import { CONFIG_FOLDER } from './definitions';

function validateNonEmpty(field, input) {
  if (input) {
    return true;
  }
  return `${field} must be non empty`;
}

export default async function () {
  const scraperIdResult = await inquirer.prompt([{
    type: 'list',
    name: 'scraperId',
    message: 'Which scraper would you like to save credentials for?',
    choices: Object.keys(SCRAPERS).map((id) => {
      return {
        name: SCRAPERS[id].name,
        value: id,
      };
    }),
  }]);
  const { loginFields } = SCRAPERS[scraperIdResult.scraperId];
  const questions = loginFields.map((field) => {
    return {
      type: field === PASSWORD_FIELD ? PASSWORD_FIELD : 'input',
      name: field,
      message: `Enter value for ${field}:`,
      validate: input => validateNonEmpty(field, input),
    };
  });
  const credentialsResult = await inquirer.prompt(questions);
  const encryptedCredentials = encryptCredentials(credentialsResult);
  await writeJsonFile(`${CONFIG_FOLDER}/${scraperIdResult.scraperId}.json`, encryptedCredentials);
  console.log(`credentials file saved for ${scraperIdResult.scraperId}`);
}
