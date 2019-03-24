import puppeteer from 'puppeteer';
import { EventEmitter } from 'events';

const eventEmitter = new EventEmitter();
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

export async function getBrowser(options = {}) {
  let env = {};
  if (options.verbose) {
    env = Object.assign({ DEBUG: '*' }, process.env);
  }
  return puppeteer.launch({ env, headless: !options.showBrowser });
}

export async function getBrowserPage(browser) {
  let result = null;
  const pages = await browser.pages();
  if (pages.length) {
    [result] = pages;
  } else {
    result = await browser.newPage();
  }
  await result.setViewport({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
  });

  return result;
}

export function emitLog(eventName, payload) {
  eventEmitter.emit(eventName, this.options.companyId, payload);
}

export const noop = () => {};
