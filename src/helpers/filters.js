function getKeyByValue(object, value) {
  return Object.keys(object).find((key) => {
    const compareTo = object[key];
    let result = false;

    result = compareTo.find((item) => {
      if (item instanceof RegExp) {
        return item.test(value);
      }

      return value.toLowerCase() === item.toLowerCase();
    });

    return !!result;
  });
}

export default getKeyByValue;
