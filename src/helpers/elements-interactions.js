async function waitUntilElementFound(page, elementSelector, onlyVisible = false, timeout = 30000) {
  await page.waitForSelector(elementSelector, { visible: onlyVisible, timeout });
}

async function fillInput(page, inputSelector, inputValue) {
  await page.$eval(inputSelector, (input) => { input.value = ''; }); // eslint-disable-line no-param-reassign
  await page.type(inputSelector, inputValue);
}

async function fillInputs(page, fields) {
  const modified = [...fields];
  const input = modified.shift();
  await fillInput(page, input.selector, input.value);
  if (modified.length) {
    return fillInputs(page, modified);
  }
  return null;
}

async function clickButton(page, buttonSelector) {
  const button = await page.$(buttonSelector);
  await button.click();
}

async function dropdownSelect(page, selectSelector, value) {
  await page.select(selectSelector, value);
}

export { waitUntilElementFound, fillInput, clickButton, fillInputs, dropdownSelect };
