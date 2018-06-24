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

async function dropdownSelect(page, selectSelector, value) {
  await page.select(selectSelector, value);
}

export {
  waitUntilElementFound,
  fillInput,
  clickButton,
  dropdownSelect,
};
