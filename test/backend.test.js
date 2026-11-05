const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseProductCatalog } = require('../lib/catalog');
const { detectProofExtension } = require('../lib/payment-proof');
const { createAdminSession, verifyAdminSession } = require('../lib/admin-auth');

test('catalog prices are read from the storefront and HTML entities are decoded', () => {
  const html = '<button data-product-name="Top &amp; Skirt" data-product-price="9200">Buy</button>';
  const products = parseProductCatalog(html);
  assert.equal(products.get('Top & Skirt'), 9200);
});

test('catalog rejects inconsistent prices for the same product', () => {
  const html = [
    '<button data-product-name="Test" data-product-price="1000">',
    '<button data-product-name="Test" data-product-price="2000">'
  ].join('');
  assert.throws(() => parseProductCatalog(html), /inconsistent prices/);
});

test('catalog contains products with valid prices used in the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const products = parseProductCatalog(html);
  assert.ok(products.size >= 20);
  for (const price of products.values()) {
    assert.ok(Number.isSafeInteger(price) && price > 0);
  }
});

test('every displayed product price matches the price used by checkout', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const cards = html.matchAll(/<article class="product-card">([\s\S]*?)<\/article>/g);
  for (const [, card] of cards) {
    const checkoutPrice = card.match(/data-product-price="(\d+)"/);
    const displayedPrice = card.match(/class="product-price">[^0-9]*([\d,]+)/);
    if (checkoutPrice && displayedPrice) {
      assert.equal(
        Number(displayedPrice[1].replaceAll(',', '')),
        Number(checkoutPrice[1]),
        'The visible card price should match its checkout price.'
      );
    }
  }
});

test('payment proofs are identified by file signatures, not names', () => {
  assert.equal(detectProofExtension(Buffer.from('%PDF-1.7')), '.pdf');
  assert.equal(detectProofExtension(Buffer.from([0xff, 0xd8, 0xff, 0x00])), '.jpg');
  assert.equal(detectProofExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), '.png');
  assert.equal(detectProofExtension(Buffer.from('not a proof file')), null);
});

test('admin session tokens are signed, expire, and expose a CSRF token', () => {
  const secret = 'a sufficiently long test-only admin secret';
  const now = 1_800_000_000_000;
  const session = createAdminSession(secret, now);
  const verified = verifyAdminSession(session.token, secret, now + 1000);

  assert.equal(verified.csrfToken, session.csrfToken);
  assert.equal(verifyAdminSession(session.token, 'different secret', now), null);
  assert.equal(verifyAdminSession(`${session.token}x`, secret, now), null);
  assert.equal(verifyAdminSession(session.token, secret, now + 8 * 60 * 60 * 1000), null);
});
