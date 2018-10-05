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
  const button = await page.$(buttonSelector);
  await button.click();
}

async function pageEvalAll(page, selector, callback) {
  let result = [];

  try {
    if (callback) {
      result = await page.$$eval(selector, callback);
    } else {
      result = await page.$$(selector);
    }
  } catch (e) {
    // TODO temporary workaround to puppeteer@1.5.0 which breaks $$eval bevahvior until they will release a new version.
    if (e.message.indexOf('Error: failed to find elements matching selector') !== 0) {
      throw e;
    }
  }

  return result;
}

async function pageEval(page, selector, callback) {
  let result = [];

  try {
    if (callback) {
      result = await page.$eval(selector, callback);
    } else {
      result = await page.$(selector);
    }
  } catch (e) {
    // TODO temporary workaround to puppeteer@1.5.0 which breaks $$eval bevahvior until they will release a new version.
    if (e.message.indexOf('Error: failed to find element matching selector') !== 0) {
      throw e;
    }
  }

  return result;
}


async function dropdownSelect(page, selectSelector, value) {
  await page.select(selectSelector, value);
}

export {
  waitUntilElementFound,
  fillInput,
  clickButton,
  dropdownSelect,
  pageEvalAll,
  pageEval,
};
