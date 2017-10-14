async function waitUntilElementFound(page, elementName, hasToBeVisible = false) {
  await page.waitForSelector(`#${elementName}`, { visible: hasToBeVisible });
}

async function fillInput(page, inputName, inputValue) {
  await page.type(`#${inputName}`, inputValue);
}

async function clickButton(page, buttonName) {
  const button = await page.$(`#${buttonName}`);
  await button.click();
}

export { waitUntilElementFound, fillInput, clickButton };
