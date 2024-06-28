
const transform = (file, api) => {
  const j = api.jscodeshift;

  const root = j(file.source);
  root
    .find(j.ImportDeclaration)
    .find(j.Literal)
    .replaceWith(nodePath => {
      const { node } = nodePath;

      if (!node.value || node.value !== 'puppeteer') {
        return node;
      }

      node.value = 'puppeteer-core';

      return node;
    });

  return root.toSource();
};

module.exports = transform;