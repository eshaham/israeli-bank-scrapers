import { Frame, Page } from 'puppeteer';

async function waitUntilElementFound(page: Page | Frame, elementSelector: string,
  onlyVisible = false, timeout = 30000) {
  await page.waitForSelector(elementSelector, { visible: onlyVisible, timeout });
}

async function waitUntilElementDisappear(page: Page, elementSelector: string, timeout = 30000) {
  await page.waitForSelector(elementSelector, { hidden: true, timeout });
}

async function fillInput(pageOrFrame: Page | Frame, inputSelector: string, inputValue: string): Promise<void> {
  await pageOrFrame.$eval(inputSelector, (input: Element) => {
    const inputElement = input;
    // @ts-ignore
    inputElement.value = '';
  });
  await pageOrFrame.type(inputSelector, inputValue);
}

async function clickButton(page: Page | Frame, buttonSelector: string) {
  await page.$eval(buttonSelector, (el) => (el as HTMLElement).click());
}

async function clickLink(page: Page, aSelector: string) {
  await page.$eval(aSelector, (el: any) => {
    if (!el || typeof el.click === 'undefined') {
      return;
    }

    el.click();
  });
}

async function pageEvalAll<R>(page: Page, selector: string,
  defaultResult: any, callback: (elements: Element[], ...args: any) => R, ...args: any[]): Promise<R> {
  let result = defaultResult;
  try {
    result = await page.$$eval(selector, callback, ...args);
  } catch (e) {
    // TODO temporary workaround to puppeteer@1.5.0 which breaks $$eval bevahvior until they will release a new version.
    if (e.message.indexOf('Error: failed to find elements matching selector') !== 0) {
      throw e;
    }
  }

  return result;
}

async function pageEval<R>(page: Page, selector: string,
  defaultResult: any, callback: (elements: Element, ...args: any) => R, ...args: any[]): Promise<R> {
  let result = defaultResult;
  try {
    result = await page.$eval(selector, callback, ...args);
  } catch (e) {
    // TODO temporary workaround to puppeteer@1.5.0 which breaks $$eval bevahvior until they will release a new version.
    if (e.message.indexOf('Error: failed to find elements matching selector') !== 0) {
      throw e;
    }
  }

  return result;
}

async function elementPresentOnPage(page: Page, selector: string) {
  return await page.$(selector) !== null;
}

async function dropdownSelect(page: Page, selectSelector: string, value: string) {
  await page.select(selectSelector, value);
}

async function dropdownElements(page: Page, selector: string) {
  const options = await page.evaluate((optionSelector) => {
    return Array.from(document.querySelectorAll(optionSelector))
      .filter((o) => o.value)
      .map((o) => {
        return {
          name: o.text,
          value: o.value,
        };
      });
  }, `${selector} > option`);
  return options;
}

export {
  waitUntilElementFound,
  waitUntilElementDisappear,
  fillInput,
  clickButton,
  clickLink,
  dropdownSelect,
  dropdownElements,
  pageEval,
  pageEvalAll,
  elementPresentOnPage,
};
