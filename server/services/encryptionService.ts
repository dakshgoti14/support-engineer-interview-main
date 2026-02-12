/**
 * Encryption Service for Sensitive Data (PII)
 *
 * Purpose: AES-256-GCM encryption for SSN and other sensitive data
 * Why AES-GCM: Provides both confidentiality and authenticity
 *
 * Security Notes:
 * - Each encryption uses a unique IV (initialization vector)
 * - Auth tag prevents tampering
 * - Key must be 32 bytes (256 bits)
 * - NEVER reuse IVs with the same key
 */

import crypto from "crypto";

export class EncryptionService {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly IV_LENGTH = 12; // 96 bits recommended for GCM
  private static readonly AUTH_TAG_LENGTH = 16; // 128 bits
  private static readonly KEY_LENGTH = 32; // 256 bits

  /**
   * Get encryption key from environment
   * Falls back to JWT_SECRET if SSN_SECRET not set (for backward compatibility)
   * In production, SSN_SECRET MUST be set
   */
  private static getEncryptionKey(): Buffer {
    let secret = process.env.SSN_SECRET || process.env.JWT_SECRET;

    if (!secret) {
      // Never throw here to avoid breaking runtime in developer environments.
      // Log an error in production so operators are alerted, but still fall back
      // to a temporary secret to keep the service functional for local dev.
      if (process.env.NODE_ENV === "production") {
        console.error("CRITICAL: SSN_SECRET or JWT_SECRET is not set. Falling back to temporary secret (insecure)!");
      } else {
        console.warn("Using temporary SSN secret for development. Set SSN_SECRET in production!");
      }
      secret = "temporary-ssn-secret";
    }

    if (process.env.NODE_ENV === "production" && !process.env.SSN_SECRET) {
      console.error("WARNING: Using JWT_SECRET for SSN encryption. Set SSN_SECRET in production!");
    }

    // Derive a 256-bit key from the secret using SHA-256
    return crypto.createHash("sha256").update(secret).digest();
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   *
   * Returns: "iv:authTag:encryptedData" (all in hex)
   *
   * @param plaintext - The sensitive data to encrypt
   * @returns Encrypted string in format "iv:authTag:encryptedData"
   */
  static encrypt(plaintext: string): string {
    try {
      const key = this.getEncryptionKey();
      const iv = crypto.randomBytes(this.IV_LENGTH);

      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      // Return: IV:AuthTag:EncryptedData (all in hex)
      return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("Failed to encrypt sensitive data");
    }
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   *
   * @param encryptedData - Data in format "iv:authTag:encryptedData"
   * @returns Decrypted plaintext
   */
  static decrypt(encryptedData: string): string {
    try {
      const key = this.getEncryptionKey();
      const parts = encryptedData.split(":");

      if (parts.length !== 3) {
        throw new Error("Invalid encrypted data format");
      }

      const iv = Buffer.from(parts[0], "hex");
      const authTag = Buffer.from(parts[1], "hex");
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("Failed to decrypt sensitive data");
    }
  }

  /**
   * Hash data (one-way)
   * Use this when you only need to verify data, not retrieve it
   *
   * @param data - Data to hash
   * @returns HMAC-SHA256 hash in hex
   */
  static hash(data: string): string {
    const key = this.getEncryptionKey();
    return crypto.createHmac("sha256", key).update(data).digest("hex");
  }

  /**
   * Generate a cryptographically secure random account number
   * Range: 1000000000 to 9999999999 (10 digits)
   */
  static generateAccountNumber(): string {
    const min = 1000000000;
    const max = 9999999999;
    const number = crypto.randomInt(min, max + 1);
    return number.toString();
  }

  /**
   * Generate a secure random token
   * @param bytes - Number of random bytes (default 32)
   * @returns Hex-encoded random token
   */
  static generateToken(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString("hex");
  }
}
