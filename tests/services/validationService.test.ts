/**
 * ValidationService Test Suite
 * Tests all validation logic for comprehensive coverage
 */

import { describe, test, expect } from "vitest";
import { ValidationService } from "@/server/services/validationService";

describe("ValidationService", () => {
  describe("validateCardNumber", () => {
    test("validates Visa card (starts with 4)", () => {
      const result = ValidationService.validateCardNumber("4532015112830366");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("Visa");
    });

    test("validates Mastercard (51-55 range)", () => {
      const result = ValidationService.validateCardNumber("5425233430109903");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("Mastercard");
    });

    test("validates Mastercard new BIN (2221-2720)", () => {
      const result = ValidationService.validateCardNumber("2223000048400011");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("Mastercard");
    });

    test("validates American Express (34, 37)", () => {
      const result = ValidationService.validateCardNumber("378282246310005");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("American Express");
    });

    test("validates Discover (6011, 65)", () => {
      const result = ValidationService.validateCardNumber("6011111111111117");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("Discover");
    });

    test("validates JCB (35)", () => {
      const result = ValidationService.validateCardNumber("3530111333300000");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("JCB");
    });

    test("rejects card with invalid Luhn checksum", () => {
      const result = ValidationService.validateCardNumber("4532015112830367");
      expect(result.valid).toBe(false);
      expect(result.cardType).toBeNull();
    });

    test("rejects card that is too short", () => {
      const result = ValidationService.validateCardNumber("453201511283");
      expect(result.valid).toBe(false);
      expect(result.cardType).toBeNull();
    });

    test("rejects card that is too long", () => {
      const result = ValidationService.validateCardNumber("45320151128303661234");
      expect(result.valid).toBe(false);
      expect(result.cardType).toBeNull();
    });

    test("rejects unsupported card type", () => {
      const result = ValidationService.validateCardNumber("9999999999999995");
      expect(result.valid).toBe(false);
      expect(result.cardType).toBeNull();
    });

    test("handles card numbers with spaces and dashes", () => {
      const result = ValidationService.validateCardNumber("4532-0151-1283-0366");
      expect(result.valid).toBe(true);
      expect(result.cardType).toBe("Visa");
    });
  });

  describe("validateRoutingNumber", () => {
    test("validates correct routing number with valid checksum", () => {
      // 122105155 is a valid routing number (Wells Fargo)
      expect(ValidationService.validateRoutingNumber("122105155")).toBe(true);
    });

    test("validates another correct routing number", () => {
      // 026009593 is a valid routing number (Bank of America)
      expect(ValidationService.validateRoutingNumber("026009593")).toBe(true);
    });

    test("rejects routing number with invalid checksum", () => {
      expect(ValidationService.validateRoutingNumber("123456789")).toBe(false);
    });

    test("rejects routing number that is too short", () => {
      expect(ValidationService.validateRoutingNumber("12345678")).toBe(false);
    });

    test("rejects routing number that is too long", () => {
      expect(ValidationService.validateRoutingNumber("1234567890")).toBe(false);
    });

    test("rejects routing number with non-digits", () => {
      expect(ValidationService.validateRoutingNumber("12345678a")).toBe(false);
    });
  });

  describe("validateStateCode", () => {
    test("validates valid state codes", () => {
      expect(ValidationService.validateStateCode("CA")).toBe(true);
      expect(ValidationService.validateStateCode("NY")).toBe(true);
      expect(ValidationService.validateStateCode("TX")).toBe(true);
      expect(ValidationService.validateStateCode("FL")).toBe(true);
    });

    test("validates lowercase state codes (auto-uppercase)", () => {
      expect(ValidationService.validateStateCode("ca")).toBe(true);
      expect(ValidationService.validateStateCode("ny")).toBe(true);
    });

    test("rejects invalid state codes", () => {
      expect(ValidationService.validateStateCode("XX")).toBe(false);
      expect(ValidationService.validateStateCode("ZZ")).toBe(false);
      expect(ValidationService.validateStateCode("00")).toBe(false);
    });

    test("rejects invalid format", () => {
      expect(ValidationService.validateStateCode("CAL")).toBe(false);
      expect(ValidationService.validateStateCode("C")).toBe(false);
    });
  });

  describe("validatePassword", () => {
    test("validates strong password", () => {
      const result = ValidationService.validatePassword("MyP@ssw0rd123");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("validates password with all requirements", () => {
      const result = ValidationService.validatePassword("SecurePass123!");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects password that is too short", () => {
      const result = ValidationService.validatePassword("Short1!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must be at least 12 characters");
    });

    test("rejects password without uppercase", () => {
      const result = ValidationService.validatePassword("mypassword123!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one uppercase letter");
    });

    test("rejects password without lowercase", () => {
      const result = ValidationService.validatePassword("MYPASSWORD123!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one lowercase letter");
    });

    test("rejects password without number", () => {
      const result = ValidationService.validatePassword("MyPassword!@#");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one number");
    });

    test("rejects password without special character", () => {
      const result = ValidationService.validatePassword("MyPassword123");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one special character");
    });

    test("rejects common password", () => {
      const result = ValidationService.validatePassword("Password123!");
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Password is too common");
    });

    test("returns multiple errors for very weak password", () => {
      const result = ValidationService.validatePassword("pass");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });

  describe("validateDateOfBirth", () => {
    test("validates valid date of birth (18+ years old)", () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 25); // 25 years old
      const result = ValidationService.validateDateOfBirth(dob.toISOString().split("T")[0]);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test("validates exactly 18 years old", () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 18);
      dob.setDate(dob.getDate() - 1); // One day past 18th birthday
      const result = ValidationService.validateDateOfBirth(dob.toISOString().split("T")[0]);
      expect(result.valid).toBe(true);
    });

    test("rejects future date", () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const result = ValidationService.validateDateOfBirth(future.toISOString().split("T")[0]);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Date of birth cannot be in the future");
    });

    test("rejects today's date", () => {
      const today = new Date().toISOString().split("T")[0];
      const result = ValidationService.validateDateOfBirth(today);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("You must be at least 18 years old");
    });

    test("rejects underage (17 years old)", () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 17);
      const result = ValidationService.validateDateOfBirth(dob.toISOString().split("T")[0]);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("You must be at least 18 years old");
    });

    test("rejects date more than 120 years ago", () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 121);
      const result = ValidationService.validateDateOfBirth(dob.toISOString().split("T")[0]);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid date of birth");
    });

    test("accepts 120 years old exactly", () => {
      const dob = new Date();
      dob.setFullYear(dob.getFullYear() - 120);
      dob.setDate(dob.getDate() + 1);
      const result = ValidationService.validateDateOfBirth(dob.toISOString().split("T")[0]);
      expect(result.valid).toBe(true);
    });

    test("rejects invalid date format", () => {
      const result = ValidationService.validateDateOfBirth("invalid-date");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid date format");
    });
  });

  describe("validateAmount", () => {
    test("validates valid amount as number", () => {
      const result = ValidationService.validateAmount(100.50);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(100.50);
    });

    test("validates valid amount as string", () => {
      const result = ValidationService.validateAmount("100.50");
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(100.50);
    });

    test("validates minimum amount (0.01)", () => {
      const result = ValidationService.validateAmount(0.01);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(0.01);
    });

    test("validates maximum amount (10000)", () => {
      const result = ValidationService.validateAmount(10000);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(10000);
    });

    test("rejects zero amount", () => {
      const result = ValidationService.validateAmount(0);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Amount must be at least $0.01");
    });

    test("rejects negative amount", () => {
      const result = ValidationService.validateAmount(-10);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Amount must be at least $0.01");
    });

    test("rejects amount over maximum", () => {
      const result = ValidationService.validateAmount(10001);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Amount cannot exceed $10,000 per transaction");
    });

    test("rounds to 2 decimal places", () => {
      const result = ValidationService.validateAmount(100.999);
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe(101.00);
    });

    test("rejects invalid string", () => {
      const result = ValidationService.validateAmount("invalid");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid amount");
    });
  });

  describe("sanitizeHtml", () => {
    test("removes HTML tags", () => {
      const result = ValidationService.sanitizeHtml("<script>alert('xss')</script>");
      expect(result).toBe("alert('xss')");
    });

    test("removes multiple HTML tags", () => {
      const result = ValidationService.sanitizeHtml("<div><p>Hello</p></div>");
      expect(result).toBe("Hello");
    });

    test("handles self-closing tags", () => {
      const result = ValidationService.sanitizeHtml("Hello<br/>World");
      expect(result).toBe("HelloWorld");
    });

    test("preserves plain text", () => {
      const result = ValidationService.sanitizeHtml("Hello World");
      expect(result).toBe("Hello World");
    });

    test("trims whitespace", () => {
      const result = ValidationService.sanitizeHtml("  Hello World  ");
      expect(result).toBe("Hello World");
    });
  });

  describe("validateEmail", () => {
    test("validates correct email", () => {
      const result = ValidationService.validateEmail("test@example.com");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("test@example.com");
    });

    test("normalizes email to lowercase", () => {
      const result = ValidationService.validateEmail("TEST@Example.COM");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("test@example.com");
    });

    test("trims whitespace", () => {
      const result = ValidationService.validateEmail("  test@example.com  ");
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("test@example.com");
    });

    test("rejects email without @", () => {
      const result = ValidationService.validateEmail("testexample.com");
      expect(result.valid).toBe(false);
    });

    test("rejects email without domain", () => {
      const result = ValidationService.validateEmail("test@");
      expect(result.valid).toBe(false);
    });

    test("rejects email without local part", () => {
      const result = ValidationService.validateEmail("@example.com");
      expect(result.valid).toBe(false);
    });
  });

  describe("validatePhoneNumber", () => {
    test("validates 10-digit phone number", () => {
      expect(ValidationService.validatePhoneNumber("1234567890")).toBe(true);
    });

    test("validates phone with country code", () => {
      expect(ValidationService.validatePhoneNumber("+11234567890")).toBe(true);
    });

    test("validates international phone (15 digits)", () => {
      expect(ValidationService.validatePhoneNumber("+123456789012345")).toBe(true);
    });

    test("rejects phone that is too short", () => {
      expect(ValidationService.validatePhoneNumber("123456789")).toBe(false);
    });

    test("rejects phone that is too long", () => {
      expect(ValidationService.validatePhoneNumber("+1234567890123456")).toBe(false);
    });

    test("rejects phone with letters", () => {
      expect(ValidationService.validatePhoneNumber("123456789a")).toBe(false);
    });

    test("rejects phone with spaces or dashes", () => {
      expect(ValidationService.validatePhoneNumber("123-456-7890")).toBe(false);
    });
  });
});
