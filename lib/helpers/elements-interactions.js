import waitUntil from '../helpers/waiting';

async function waitUntilElementFound(page, elementName, hasToBeVisible = false) {
  await waitUntil(() => {
    return page.evaluate((elementName, hasToBeVisible) => {
      const element = document.getElementById(elementName);
      return element !== null && (!hasToBeVisible || element.style.display === 'block');
    }, elementName, hasToBeVisible);
  }, `waiting for element with id ${elementName}`);
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
