const fs = require('node:fs');

function decodeHtmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseProductCatalog(html) {
  const products = new Map();
  const pattern = /data-product-name="([^"]+)"\s+data-product-price="(\d+)"/g;
  for (const match of html.matchAll(pattern)) {
    const name = decodeHtmlEntities(match[1]);
    const price = Number(match[2]);
    if (!name || !Number.isSafeInteger(price) || price < 1) {
      throw new Error(`Invalid product configuration in index.html for "${name}".`);
    }
    const existingPrice = products.get(name);
    if (existingPrice !== undefined && existingPrice !== price) {
      throw new Error(`Product "${name}" has inconsistent prices in index.html.`);
    }
    products.set(name, price);
  }
  if (products.size === 0) {
    throw new Error('No purchasable products were found in index.html.');
  }
  return products;
}

function loadProductCatalog(filename) {
  return parseProductCatalog(fs.readFileSync(filename, 'utf8'));
}

module.exports = { loadProductCatalog, parseProductCatalog };
