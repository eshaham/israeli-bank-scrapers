import waitUntil from '../helpers/waiting';

async function waitUntilElementFound(page, elementName) {
  await waitUntil(() => {
    return page.evaluate((elementName) => {
      return document.getElementById(elementName) !== null;
    }, elementName);
  });
}

async function fillInput(page, inputName, inputValue) {
  await page.evaluate((inputName, inputValue) => {
    const input = document.getElementById(inputName);
    input.value = inputValue;
  }, inputName, inputValue);
}

async function clickButton(page, buttonName) {
  await page.evaluate((buttonName) => {
    const button = document.getElementById(buttonName);
    button.click();
  }, buttonName);
}

export { waitUntilElementFound, fillInput, clickButton };
