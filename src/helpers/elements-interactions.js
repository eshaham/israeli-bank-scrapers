async function waitUntilElementFound(page, elementSelector, onlyVisible = false, timeout = 30000) {
  await page.waitForSelector(elementSelector, { visible: onlyVisible, timeout });
}

async function fillInput(page, inputSelector, inputValue) {
  await page.$eval(inputSelector, (input) => {
    const inputElement = input;
    inputElement.value = '';
  });
  await page.type(inputSelector, inputValue);
}

async function clickButton(page, buttonSelector) {
  await page.$eval(buttonSelector, (el) => el.click());
}

async function clickLink(page, aSelector) {
  await page.$eval(aSelector, (el) => el.click());
}

async function pageEvalAll(page, selector, defaultResult, callback) {
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

async function elementPresentOnPage(page, selector) {
  return await page.$(selector) !== null;
}

async function dropdownSelect(page, selectSelector, value) {
  await page.select(selectSelector, value);
}

async function dropdownElements(page, selector) {
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
