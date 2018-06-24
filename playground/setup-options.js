import moment from 'moment';
import inquirer from 'inquirer';
import { SCRAPERS } from '../src';
import { readSettingsFile, writeSettingsFile } from './helpers/settings';

export default async function () {
  const settings = await readSettingsFile();
  const {
    scraperId,
    combineInstallments,
    startDate,
    saveLocation,
  } = settings;

  const startOfMonthMoment = moment().startOf('month');
  const monthOptions = [];
  for (let i = 0; i < 6; i += 1) {
    const monthMoment = startOfMonthMoment.clone().subtract(i, 'month');
    monthOptions.push({
      name: monthMoment.format('ll'),
      value: monthMoment,
    });
  }
  const result = await inquirer.prompt([
    {
      type: 'list',
      name: 'scraperId',
      message: 'Which bank would you like to scrape?',
      choices: Object.keys(SCRAPERS).map((id) => {
        return {
          name: SCRAPERS[id].name,
          value: id,
        };
      }),
      default: scraperId,

    },
    {
      type: 'confirm',
      name: 'combineInstallments',
      message: 'Combine installment transactions?',
      default: !!combineInstallments,
    },
    {
      type: 'list',
      name: 'startDate',
      message: 'What date would you like to start scraping from?',
      choices: monthOptions,
      default: startDate,
    },
    {
      type: 'input',
      name: 'saveLocation',
      message: 'Save folder?',
      default: saveLocation,
    },
  ]);

  settings.scraperId = result.scraperId;
  settings.combineInstallments = result.combineInstallments;
  settings.startDate = result.startDate;
  settings.saveLocation = result.saveLocation;
  await writeSettingsFile(settings);

  console.log('playground options saved, to start scraping run "npm start"');
}
