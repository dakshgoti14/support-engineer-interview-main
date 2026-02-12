/**
 * Test Setup
 * Runs before all tests
 */

import { beforeAll, afterAll } from "vitest";

// Set test environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-testing-only";
process.env.SSN_SECRET = "test-ssn-secret-for-testing-only";
process.env.NODE_ENV = "test";

beforeAll(() => {
  console.log("🧪 Test environment initialized");
});

afterAll(() => {
  console.log("✅ Test suite completed");
});
