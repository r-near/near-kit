/**
 * Tests for utility functions
 */

import { describe, test, expect } from 'bun:test';
import {
  parseNearAmount,
  formatNearAmount,
  parseGas,
  formatGas,
  toGas,
  toTGas,
} from './format.js';

describe('parseNearAmount', () => {
  test('parses simple NEAR amount', () => {
    const result = parseNearAmount('10');
    expect(result).toBe('10000000000000000000000000');
  });

  test('parses NEAR with suffix', () => {
    const result = parseNearAmount('10 NEAR');
    expect(result).toBe('10000000000000000000000000');
  });

  test('parses decimal NEAR amount', () => {
    const result = parseNearAmount('1.5');
    expect(result).toBe('1500000000000000000000000');
  });

  test('parses number input', () => {
    const result = parseNearAmount(10);
    expect(result).toBe('10000000000000000000000000');
  });
});

describe('formatNearAmount', () => {
  test('formats whole NEAR amount', () => {
    const result = formatNearAmount('10000000000000000000000000');
    expect(result).toBe('10 NEAR');
  });

  test('formats decimal NEAR amount', () => {
    const result = formatNearAmount('1500000000000000000000000');
    expect(result).toBe('1.50 NEAR');
  });

  test('formats with custom precision', () => {
    const result = formatNearAmount('1234567890000000000000000', 4);
    expect(result).toBe('1.2345 NEAR');
  });
});

describe('parseGas', () => {
  test('parses TGas format', () => {
    const result = parseGas('30 Tgas');
    expect(result).toBe('30000000000000');
  });

  test('parses raw gas number', () => {
    const result = parseGas('30000000000000');
    expect(result).toBe('30000000000000');
  });

  test('parses number input', () => {
    const result = parseGas(30000000000000);
    expect(result).toBe('30000000000000');
  });
});

describe('formatGas', () => {
  test('formats gas to TGas', () => {
    const result = formatGas('30000000000000');
    expect(result).toBe('30.00 Tgas');
  });

  test('formats bigint gas', () => {
    const result = formatGas(BigInt('30000000000000'));
    expect(result).toBe('30.00 Tgas');
  });
});

describe('toGas', () => {
  test('converts TGas to raw gas', () => {
    const result = toGas(30);
    expect(result).toBe('30000000000000');
  });

  test('handles decimal TGas', () => {
    const result = toGas(1.5);
    expect(result).toBe('1500000000000');
  });
});

describe('toTGas', () => {
  test('converts raw gas to TGas', () => {
    const result = toTGas('30000000000000');
    expect(result).toBe(30);
  });

  test('handles bigint input', () => {
    const result = toTGas(BigInt('30000000000000'));
    expect(result).toBe(30);
  });
});
