import { SETTINGS_FILE, DOWNLOAD_FOLDER } from '../definitions';
import { writeJsonFile, readJsonFile } from './files';

export async function readSettingsFile() {
  let settings = await readJsonFile(SETTINGS_FILE);
  if (!settings) {
    settings = {
      saveLocation: DOWNLOAD_FOLDER,
    };
  }

  return settings;
}

export async function writeSettingsFile(settings) {
  if (settings) {
    await writeJsonFile(SETTINGS_FILE, settings);
  }
}
