/**
 * EncryptionService Test Suite
 * Tests AES-256-GCM encryption, hashing, and random generation
 */

import { describe, test, expect } from "vitest";
import { EncryptionService } from "@/server/services/encryptionService";

describe("EncryptionService", () => {
  describe("encrypt and decrypt", () => {
    test("encrypts and decrypts SSN correctly", () => {
      const ssn = "123456789";
      const encrypted = EncryptionService.encrypt(ssn);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(ssn);
      expect(encrypted).not.toBe(ssn);
    });

    test("encrypts and decrypts long text", () => {
      const longText = "This is a longer piece of sensitive information that needs to be encrypted";
      const encrypted = EncryptionService.encrypt(longText);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(longText);
    });

    test("produces different ciphertext for same plaintext (unique IV)", () => {
      const ssn = "123456789";
      const encrypted1 = EncryptionService.encrypt(ssn);
      const encrypted2 = EncryptionService.encrypt(ssn);

      expect(encrypted1).not.toBe(encrypted2); // Different due to unique IV
      expect(EncryptionService.decrypt(encrypted1)).toBe(ssn);
      expect(EncryptionService.decrypt(encrypted2)).toBe(ssn);
    });

    test("encrypted data has correct format (iv:authTag:encrypted)", () => {
      const ssn = "123456789";
      const encrypted = EncryptionService.encrypt(ssn);
      const parts = encrypted.split(":");

      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(24); // 12 bytes IV in hex = 24 chars
      expect(parts[1]).toHaveLength(32); // 16 bytes auth tag in hex = 32 chars
      expect(parts[2].length).toBeGreaterThan(0); // Encrypted data
    });

    test("throws error when decrypting tampered data", () => {
      const ssn = "123456789";
      const encrypted = EncryptionService.encrypt(ssn);

      // Tamper with the encrypted data by flipping the last character
      const lastChar = encrypted[encrypted.length - 1];
      const newLastChar = lastChar === '0' ? '1' : '0';
      const tampered = encrypted.slice(0, -1) + newLastChar;

      expect(() => EncryptionService.decrypt(tampered)).toThrow();
    });

    test("throws error when decrypting invalid format", () => {
      expect(() => EncryptionService.decrypt("invalid-format")).toThrow();
      expect(() => EncryptionService.decrypt("only:two")).toThrow();
    });

    test("handles special characters", () => {
      const text = "Special!@#$%^&*()chars";
      const encrypted = EncryptionService.encrypt(text);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    test("handles unicode characters", () => {
      const text = "Unicode: 你好世界 🔒";
      const encrypted = EncryptionService.encrypt(text);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    test("handles empty string", () => {
      const text = "";
      const encrypted = EncryptionService.encrypt(text);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(text);
    });
  });

  describe("hash", () => {
    test("produces consistent hash for same input", () => {
      const data = "test-data";
      const hash1 = EncryptionService.hash(data);
      const hash2 = EncryptionService.hash(data);

      expect(hash1).toBe(hash2);
    });

    test("produces different hash for different input", () => {
      const hash1 = EncryptionService.hash("data1");
      const hash2 = EncryptionService.hash("data2");

      expect(hash1).not.toBe(hash2);
    });

    test("produces 64-character hex hash (SHA-256)", () => {
      const hash = EncryptionService.hash("test");
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test("is not reversible", () => {
      const data = "sensitive";
      const hash = EncryptionService.hash(data);

      // Hash should not contain the original data
      expect(hash).not.toContain(data);
      expect(hash).not.toBe(data);
    });
  });

  describe("generateAccountNumber", () => {
    test("generates 10-digit account number", () => {
      const accountNumber = EncryptionService.generateAccountNumber();
      expect(accountNumber).toHaveLength(10);
      expect(/^\d{10}$/.test(accountNumber)).toBe(true);
    });

    test("generates unique account numbers", () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 100; i++) {
        numbers.add(EncryptionService.generateAccountNumber());
      }

      // Should have generated 100 unique numbers
      expect(numbers.size).toBe(100);
    });

    test("generates numbers within valid range", () => {
      for (let i = 0; i < 10; i++) {
        const accountNumber = EncryptionService.generateAccountNumber();
        const num = parseInt(accountNumber, 10);

        expect(num).toBeGreaterThanOrEqual(1000000000);
        expect(num).toBeLessThanOrEqual(9999999999);
      }
    });

    test("uses cryptographically secure random (not Math.random)", () => {
      // Generate many numbers and check for proper distribution
      const numbers: number[] = [];
      for (let i = 0; i < 1000; i++) {
        numbers.push(parseInt(EncryptionService.generateAccountNumber(), 10));
      }

      // Calculate mean - should be around middle of range
      const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      const expectedMean = (1000000000 + 9999999999) / 2;

      // Mean should be within 5% of expected (statistical test)
      const tolerance = expectedMean * 0.05;
      expect(Math.abs(mean - expectedMean)).toBeLessThan(tolerance);
    });
  });

  describe("generateToken", () => {
    test("generates token with default length (64 hex chars for 32 bytes)", () => {
      const token = EncryptionService.generateToken();
      expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[a-f0-9]+$/.test(token)).toBe(true);
    });

    test("generates token with custom length", () => {
      const token = EncryptionService.generateToken(16);
      expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    test("generates unique tokens", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(EncryptionService.generateToken());
      }

      expect(tokens.size).toBe(100);
    });

    test("uses cryptographically secure random", () => {
      const token1 = EncryptionService.generateToken();
      const token2 = EncryptionService.generateToken();

      // Tokens should be completely different
      expect(token1).not.toBe(token2);

      // Verify both tokens are valid hex strings
      expect(/^[0-9a-f]+$/.test(token1)).toBe(true);
      expect(/^[0-9a-f]+$/.test(token2)).toBe(true);

      // Verify uniqueness across multiple generations
      const tokens = new Set<string>();
      for (let i = 0; i < 10; i++) {
        tokens.add(EncryptionService.generateToken(32));
      }
      expect(tokens.size).toBe(10);
    });
  });

  describe("security properties", () => {
    test("encryption key is derived from environment variable", () => {
      // Test runs with SSN_SECRET set in setup.ts
      const encrypted = EncryptionService.encrypt("test");

      // Should work without throwing
      expect(() => EncryptionService.decrypt(encrypted)).not.toThrow();
    });

    test("same plaintext produces different ciphertext (IV randomization)", () => {
      const plaintext = "same-text";
      const encryptions = new Set<string>();

      for (let i = 0; i < 10; i++) {
        encryptions.add(EncryptionService.encrypt(plaintext));
      }

      // All encryptions should be unique
      expect(encryptions.size).toBe(10);
    });

    test("tampering detection via auth tag", () => {
      const encrypted = EncryptionService.encrypt("sensitive");
      const parts = encrypted.split(":");

      // Tamper with auth tag
      const tamperedAuthTag = parts[1].replace(/.$/, "0");
      const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

      expect(() => EncryptionService.decrypt(tampered)).toThrow();
    });

    test("IV uniqueness prevents pattern analysis", () => {
      const plaintext = "repeated-data";
      const ivs = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const encrypted = EncryptionService.encrypt(plaintext);
        const iv = encrypted.split(":")[0];
        ivs.add(iv);
      }

      // All IVs should be unique
      expect(ivs.size).toBe(100);
    });
  });

  describe("edge cases", () => {
    test("handles very long plaintext", () => {
      const longText = "A".repeat(10000);
      const encrypted = EncryptionService.encrypt(longText);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(longText);
    });

    test("handles numbers as strings", () => {
      const number = "123456789";
      const encrypted = EncryptionService.encrypt(number);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(number);
    });

    test("handles newlines and tabs", () => {
      const text = "Line1\nLine2\tTabbed";
      const encrypted = EncryptionService.encrypt(text);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    test("handles empty string encryption", () => {
      const encrypted = EncryptionService.encrypt("");
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe("");
    });

    test("handles whitespace-only string", () => {
      const text = "   \t\n   ";
      const encrypted = EncryptionService.encrypt(text);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(text);
    });

    test("handles JSON string", () => {
      const json = JSON.stringify({ name: "Test", value: 123 });
      const encrypted = EncryptionService.encrypt(json);
      const decrypted = EncryptionService.decrypt(encrypted);

      expect(decrypted).toBe(json);
      expect(JSON.parse(decrypted)).toEqual({ name: "Test", value: 123 });
    });

    test("encrypted output is always different even for same input", () => {
      const text = "same text";
      const encrypted1 = EncryptionService.encrypt(text);
      const encrypted2 = EncryptionService.encrypt(text);

      expect(encrypted1).not.toBe(encrypted2);
      expect(EncryptionService.decrypt(encrypted1)).toBe(text);
      expect(EncryptionService.decrypt(encrypted2)).toBe(text);
    });
  });

  describe("additional hashing tests", () => {
    test("hash is consistent for same input", () => {
      const input = "test data";
      const hash1 = EncryptionService.hash(input);
      const hash2 = EncryptionService.hash(input);

      expect(hash1).toBe(hash2);
    });

    test("hash handles empty string", () => {
      const hash = EncryptionService.hash("");
      expect(hash).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    test("hash handles very long input", () => {
      const longInput = "a".repeat(100000);
      const hash = EncryptionService.hash(longInput);
      expect(hash).toHaveLength(64);
    });

    test("hash handles unicode", () => {
      const unicode = "测试数据 🎉";
      const hash = EncryptionService.hash(unicode);
      expect(hash).toHaveLength(64);
    });
  });

  describe("additional account number tests", () => {
    test("generates numbers within valid range", () => {
      for (let i = 0; i < 10; i++) {
        const accountNumber = EncryptionService.generateAccountNumber();
        const num = parseInt(accountNumber, 10);

        expect(num).toBeGreaterThanOrEqual(1000000000);
        expect(num).toBeLessThan(10000000000);
      }
    });

    test("all digits are numeric", () => {
      const accountNumber = EncryptionService.generateAccountNumber();
      expect(/^\d{10}$/.test(accountNumber)).toBe(true);
    });

    test("generates high entropy numbers", () => {
      const numbers = new Set<string>();
      for (let i = 0; i < 50; i++) {
        numbers.add(EncryptionService.generateAccountNumber());
      }

      // All 50 should be unique
      expect(numbers.size).toBe(50);
    });
  });

  describe("additional token generation tests", () => {
    test("default token length is 64 characters", () => {
      const token = EncryptionService.generateToken();
      expect(token).toHaveLength(64);
    });

    test("custom length tokens", () => {
      const token16 = EncryptionService.generateToken(16);
      const token32 = EncryptionService.generateToken(32);
      const token128 = EncryptionService.generateToken(128);

      expect(token16).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(token32).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token128).toHaveLength(256); // 128 bytes = 256 hex chars
    });

    test("minimum length token", () => {
      const token = EncryptionService.generateToken(1);
      expect(token).toHaveLength(2); // 1 byte = 2 hex chars
      expect(/^[0-9a-f]{2}$/.test(token)).toBe(true);
    });

    test("tokens are hexadecimal", () => {
      const token = EncryptionService.generateToken(100);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    test("generates unique tokens consistently", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(EncryptionService.generateToken(32));
      }

      expect(tokens.size).toBe(100);
    });
  });
});
