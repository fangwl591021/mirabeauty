import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, normalizeNameCompany, normalizePhone } from '../src/card-collection.js';

test('phone normalization treats Taiwan international and local formats as the same contact', () => {
  assert.equal(normalizePhone('+886 912-345-678'), '0912345678');
  assert.equal(normalizePhone('0912 345 678'), '0912345678');
});

test('email and name-company keys are stable for duplicate detection', () => {
  assert.equal(normalizeEmail(' Mira@Example.COM '), 'mira@example.com');
  assert.equal(normalizeNameCompany('王 小美', '米拉（股份）公司'), normalizeNameCompany('王小美', '米拉股份公司'));
});
