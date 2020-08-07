import { Page } from 'puppeteer';

async function waitUntilElementFound(page: Page, elementSelector: string,
  onlyVisible = false, timeout = 30000) {
  await page.waitForSelector(elementSelector, { visible: onlyVisible, timeout });
}

async function fillInput(page: Page, inputSelector: string, inputValue: string): Promise<void> {
  await page.$eval(inputSelector, (input: Element) => {
    const inputElement = input;
    // @ts-ignore
    inputElement.value = '';
  });
  await page.type(inputSelector, inputValue);
}

async function clickButton(page: Page, buttonSelector: string) {
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
  defaultResult: any, callback: (elements: Element[]) => R): Promise<R> {
  let result = defaultResult;
  try {
    result = await page.$$eval(selector, callback);
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
  fillInput,
  clickButton,
  clickLink,
  dropdownSelect,
  dropdownElements,
  pageEvalAll,
  elementPresentOnPage,
};
