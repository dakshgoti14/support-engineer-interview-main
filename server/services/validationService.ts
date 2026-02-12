/**
 * Centralized Validation Service
 *
 * Purpose: Single source of truth for all validation logic
 * Prevents duplication and ensures consistency
 */

import { TRPCError } from "@trpc/server";

export class ValidationService {
  private static readonly US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  ];

  /**
   * Validate card number using Luhn algorithm
   * Returns: { valid: boolean, cardType: string | null }
   */
  static validateCardNumber(cardNumber: string): { valid: boolean; cardType: string | null } {
    const digits = cardNumber.replace(/\D/g, "");

    // Validate length (13-19 digits for most cards)
    if (digits.length < 13 || digits.length > 19) {
      return { valid: false, cardType: null };
    }

    // Detect card type by prefix
    let cardType: string | null = null;
    if (digits.startsWith("4")) {
      cardType = "Visa";
    } else if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) {
      cardType = "Mastercard";
    } else if (/^3[47]/.test(digits)) {
      cardType = "American Express";
    } else if (/^6(?:011|5)/.test(digits)) {
      cardType = "Discover";
    } else if (/^35/.test(digits)) {
      cardType = "JCB";
    } else {
      return { valid: false, cardType: null };
    }

    // Luhn algorithm
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }

    const isValid = sum % 10 === 0;
    return { valid: isValid, cardType: isValid ? cardType : null };
  }

  /**
   * Validate ABA routing number with checksum
   * US routing numbers use modulo 10 checksum
   */
  static validateRoutingNumber(routingNumber: string): boolean {
    if (!/^\d{9}$/.test(routingNumber)) {
      return false;
    }

    // ABA routing number checksum algorithm
    const digits = routingNumber.split("").map(Number);
    const checksum =
      3 * (digits[0] + digits[3] + digits[6]) +
      7 * (digits[1] + digits[4] + digits[7]) +
      (digits[2] + digits[5] + digits[8]);

    return checksum % 10 === 0;
  }

  /**
   * Validate US state code
   */
  static validateStateCode(stateCode: string): boolean {
    return this.US_STATES.includes(stateCode.toUpperCase());
  }

  /**
   * Validate password complexity
   * Requirements: min 12 chars, uppercase, lowercase, number, special char
   */
  static validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 12) {
      errors.push("Password must be at least 12 characters");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push("Password must contain at least one special character");
    }

    // Check against common passwords
    const commonPasswords = ["password", "12345678", "qwerty", "password123", "admin123"];
    if (commonPasswords.some((common) => password.toLowerCase().includes(common))) {
      errors.push("Password is too common");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate date of birth
   * Requirements: 18+, not in future, not >120 years old
   */
  static validateDateOfBirth(dob: string): { valid: boolean; error?: string } {
    const date = new Date(dob);
    const now = new Date();

    if (Number.isNaN(date.getTime())) {
      return { valid: false, error: "Invalid date format" };
    }

    // Check future date
    if (date > now) {
      return { valid: false, error: "Date of birth cannot be in the future" };
    }

    // Check age >= 18
    const ageMs = now.getTime() - date.getTime();
    const age = ageMs / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) {
      return { valid: false, error: "You must be at least 18 years old" };
    }

    // Check not too old (120 years)
    if (age > 120) {
      return { valid: false, error: "Invalid date of birth" };
    }

    return { valid: true };
  }

  /**
   * Validate and sanitize amount
   * Prevents: leading zeros, negative amounts, extreme values
   */
  static validateAmount(amount: number | string): { valid: boolean; sanitized: number; error?: string } {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;

    if (Number.isNaN(num)) {
      return { valid: false, sanitized: 0, error: "Invalid amount" };
    }

    if (num < 0.01) {
      return { valid: false, sanitized: 0, error: "Amount must be at least $0.01" };
    }

    if (num > 10000) {
      return { valid: false, sanitized: 0, error: "Amount cannot exceed $10,000 per transaction" };
    }

    // Round to 2 decimal places
    const sanitized = Math.round(num * 100) / 100;

    return { valid: true, sanitized };
  }

  /**
   * Sanitize HTML to prevent XSS
   */
  static sanitizeHtml(input: string): string {
    return input.replace(/<[^>]*>/g, "").trim();
  }

  /**
   * Validate email format
   */
  static validateEmail(email: string): { valid: boolean; normalized: string } {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalized = email.toLowerCase().trim();
    return { valid: emailRegex.test(normalized), normalized };
  }

  /**
   * Validate phone number (US and international)
   */
  static validatePhoneNumber(phone: string): boolean {
    // Allow 10-15 digits with optional + prefix
    return /^\+?\d{10,15}$/.test(phone);
  }
}
