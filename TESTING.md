# Testing Guide for Bug Fixes

This document provides test cases to verify all 23 bug fixes are working correctly.

## Setup for Testing

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# In another terminal, you can use database utilities
npm run db:list-users
npm run db:list-sessions
npm run db:clear
```

---

## Critical Security Tests

### TEST SEC-303: XSS Protection
**Expected:** Transaction descriptions are sanitized, no script execution

```bash
# Test Case:
# 1. Create an account
# 2. Fund the account
# 3. Check transaction description in database
# 4. Verify no HTML tags are stored

npm run db:list-users
# Then in the app: check transaction history for any HTML injection attempts
```

**Pass Criteria:**
- Transaction descriptions contain no HTML tags
- Description shows "Funding from card" or "Funding from bank" only

---

### TEST VAL-202: Date of Birth Validation
**Expected:** Future dates and invalid ages are rejected

Test cases:
1. ✅ **Future Date:** Try DOB = 2025-01-01
   - Expected: Error "Date of birth cannot be in the future"

2. ✅ **Underage:** Try DOB = 2010-01-01 (16 years old)
   - Expected: Error "You must be at least 18 years old"

3. ✅ **Too Old:** Try DOB = 1850-01-01
   - Expected: Error "Date of birth cannot be...more than 120 years ago"

4. ✅ **Valid:** Try DOB = 2000-01-01 (24 years old)
   - Expected: Success

**How to Test:**
1. Go to /signup
2. Fill Step 1 (email, password)
3. Fill Step 2 with various DOBs listed above
4. Verify error messages match expected

---

### TEST VAL-206: Card Number Validation
**Expected:** Various card types accepted, invalid cards rejected

Test cases:
```
Valid Cards:
✅ Visa: 4532015112830366
✅ Mastercard (old): 5425233430109903
✅ Mastercard (new): 2223000048410010
✅ Amex: 374245455400126
✅ Discover: 6011111111111117
✅ JCB: 3530111333300000

Invalid Cards:
❌ Wrong checksum: 4532015112830367 (fails Luhn)
❌ Too short: 453201
❌ Unsupported type: 1234567890123456
❌ Wrong prefix: 9999999999999999
```

**How to Test:**
1. Create account and go to dashboard
2. Click "Fund Account"
3. Select "Credit/Debit Card"
4. Enter card numbers above
5. Verify valid cards accepted, invalid rejected

---

### TEST VAL-208: Password Complexity
**Expected:** Weak passwords are rejected

Test cases:
```
Invalid Passwords:
❌ "password" - too common
❌ "12345678" - no uppercase, no special char
❌ "Password" - no number, no special char
❌ "Password1" - no special char
❌ "password1!" - no uppercase
❌ "PASSWORD1!" - no lowercase

Valid Passwords:
✅ "Password1!"
✅ "MyP@ssw0rd"
✅ "Secure#2024"
```

**How to Test:**
1. Go to /signup
2. Try passwords listed above
3. Verify client-side validation shows errors
4. Submit form to verify server-side validation

---

### TEST PERF-401: Account Creation Error Handling
**Expected:** No incorrect balances displayed on errors

Test case:
1. Create account normally
2. Verify initial balance is $0.00
3. Check database: `npm run db:list-users`
4. Verify balance in DB is 0

**Pass Criteria:**
- New accounts always show $0.00 balance
- No phantom balances appear

---

### TEST PERF-408: Database Resource Cleanup
**Expected:** Database connections close properly

```bash
# Start app
npm run dev

# Check process doesn't accumulate open file descriptors
# On Mac/Linux:
lsof -p $(pgrep -f "node.*next") | grep bank.db | wc -l

# Stop app with Ctrl+C
# Verify database file is not locked
sqlite3 bank.db "SELECT * FROM users LIMIT 1;"
```

**Pass Criteria:**
- Database commands work after app shutdown
- No "database is locked" errors

---

## High Priority Tests

### TEST VAL-201: Email Lowercase Notification
**Expected:** Users see email will be lowercased

**How to Test:**
1. Go to /signup
2. Type email: "TEST@Example.COM"
3. Verify you see text: "Email will be converted to lowercase"
4. Verify input shows lowercase (CSS class applied)
5. Submit and check database - email should be "test@example.com"

---

### TEST VAL-205: Zero Amount Rejection
**Expected:** $0.00 funding is rejected

**How to Test:**
1. Create account
2. Click "Fund Account"
3. Enter amount: "0.00"
4. Expected error: "Amount must be at least $0.01"
5. Try: "0" - should also be rejected
6. Try: "0.01" - should be accepted

---

### TEST VAL-207: Routing Number Required for Bank Transfers
**Expected:** Routing number required for bank funding, not for card

**How to Test:**
1. Create account
2. Click "Fund Account"
3. Select "Bank Account" funding type
4. Leave routing number empty
5. Expected error: "Routing number is required"
6. Enter invalid routing: "12345678" (8 digits)
7. Expected error: "Routing number must be 9 digits"
8. Enter valid routing: "123456789"
9. Should proceed

---

### TEST VAL-210: Multiple Card Types
**Expected:** Visa, Mastercard, Amex, Discover, JCB accepted

See TEST VAL-206 above for detailed test cases.

---

### TEST PERF-403: Session Expiry
**Expected:** Sessions expire at exact expiry time

This requires manual testing or automated test:

```javascript
// Pseudo-test
// 1. Create session with expiresAt = now + 5 seconds
// 2. Wait 4 seconds - session should be valid
// 3. Wait 2 more seconds - session should be invalid
// 4. Verify user is logged out
```

**Manual Test:**
1. Log in
2. Check cookie expiration (7 days)
3. Manually set cookie to expire in 1 minute
4. Wait 1 minute
5. Try to access dashboard
6. Should redirect to login

---

### TEST PERF-407: Transaction Query Performance
**Expected:** Single query for all transactions

**How to Test:**
1. Create account
2. Fund account 10 times
3. Open browser DevTools > Network
4. View transaction history
5. Check tRPC call to getTransactions
6. Verify response shows all 10 transactions
7. Verify transactions are sorted newest first

**Database Test:**
```bash
# Enable query logging (if available)
# Check logs show only 2 queries:
# 1. SELECT account WHERE id = ? (verify ownership)
# 2. SELECT transactions WHERE account_id = ?
# NOT: 10 separate SELECT account queries (N+1)
```

---

## Medium Priority Tests

### TEST UI-101: Dark Mode Text Visibility
**Expected:** Input text visible in both light and dark modes

**How to Test:**
1. **Light Mode:**
   - System Preferences > Appearance > Light
   - Go to /signup
   - Verify input text is dark/black
   - Verify input background is white/light
   - Type in email field - text should be visible

2. **Dark Mode:**
   - System Preferences > Appearance > Dark
   - Go to /signup
   - Verify input text is white/light
   - Verify input background is dark gray
   - Type in email field - text should be visible
   - Background should NOT be white

**Pass Criteria:**
- Light mode: Black text on white background
- Dark mode: White text on dark gray background
- Text always readable/visible

---

### TEST VAL-203: State Code Validation
**Expected:** Only valid US state codes accepted

Test cases:
```
Valid:
✅ "CA"
✅ "NY"
✅ "TX"
✅ "ca" (should convert to uppercase)

Invalid:
❌ "XX"
❌ "ZZ"
❌ "CAL" (too long)
❌ "1A"
```

**How to Test:**
1. Go to /signup Step 3
2. Try state codes above
3. Verify valid ones accepted
4. Verify invalid ones show error: "Invalid US state code"

---

### TEST VAL-204: Phone Number Format
**Expected:** Various phone formats accepted

Test cases:
```
Valid:
✅ "1234567890" (10 digits)
✅ "+11234567890" (with country code)
✅ "12345678901" (11 digits)
✅ "+123456789012345" (15 digits max)

Invalid:
❌ "123456789" (9 digits)
❌ "1234567890123456" (16 digits)
❌ "+1234" (too short)
❌ "123-456-7890" (has dashes)
```

**How to Test:**
1. Go to /signup Step 2
2. Enter phone numbers above
3. Verify validation messages

---

### TEST VAL-209: Leading Zeros in Amount
**Expected:** Leading zeros rejected

Test cases:
```
Invalid:
❌ "00123.45" - leading zeros
❌ "0123" - leading zeros
❌ "00.00" - all zeros

Valid:
✅ "123.45"
✅ "1.00"
✅ "0.01" (valid minimum)
```

**How to Test:**
1. Fund account
2. Enter amounts above
3. Verify leading zeros rejected
4. Verify error: "Invalid amount format (no leading zeros)"

---

### TEST PERF-402: Logout Verification
**Expected:** Logout properly invalidates session

**How to Test:**
1. Log in to account
2. Open browser DevTools > Application > Cookies
3. Note session cookie value
4. Click "Sign Out"
5. Check response: `{"success": true, "message": "Logged out successfully"}`
6. Verify session cookie is cleared
7. Try to access /dashboard
8. Should redirect to login
9. Check database: session should be deleted
   ```bash
   npm run db:list-sessions
   ```

**Pass Criteria:**
- Cookie cleared
- Session deleted from database
- Cannot access protected routes
- Success message accurate

---

### TEST PERF-404: Transaction Sorting
**Expected:** Transactions sorted newest first

**How to Test:**
1. Create account
2. Fund account multiple times:
   - First: $10
   - Second: $20
   - Third: $30
3. View transaction history
4. Verify order is:
   - $30 (newest)
   - $20
   - $10 (oldest)

---

### TEST SEC-301: SSN Hashing Verification
**Expected:** SSN stored as hash, not plaintext

**How to Test:**
1. Sign up with SSN: 123456789
2. Check database:
   ```bash
   npm run db:list-users
   ```
3. Verify SSN column contains a hash (64 hex characters)
4. Should NOT see "123456789"
5. Should see something like: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

**Pass Criteria:**
- SSN is hashed
- Hash is 64 characters (SHA-256)
- Original SSN not visible in database

---

## Automated Test Suite

For automated testing, create test files:

```bash
# Create test directory
mkdir -p __tests__

# Run tests (after implementing)
npm test
```

### Example Test File Structure

```
__tests__/
├── validation/
│   ├── email.test.ts
│   ├── password.test.ts
│   ├── dob.test.ts
│   ├── card.test.ts
│   ├── phone.test.ts
│   └── amount.test.ts
├── security/
│   ├── xss.test.ts
│   ├── ssn.test.ts
│   └── session.test.ts
├── performance/
│   ├── queries.test.ts
│   └── transactions.test.ts
└── integration/
    ├── signup.test.ts
    ├── login.test.ts
    ├── account.test.ts
    └── funding.test.ts
```

---

## Test Coverage Goals

- **Unit Tests:** 80% coverage minimum
- **Integration Tests:** All critical user flows
- **E2E Tests:** Signup, login, account creation, funding
- **Security Tests:** All input validation, XSS, injection
- **Performance Tests:** N+1 queries, large datasets

---

## Continuous Testing

### Pre-commit Checks
- Run linter
- Run type checker
- Run unit tests

### CI/CD Pipeline
- Run full test suite
- Security scanning
- Performance regression tests
- Visual regression tests (dark mode)

---

## Manual QA Checklist

Before releasing to production:

- [ ] Test signup flow (all 3 steps)
- [ ] Test login flow
- [ ] Test logout flow
- [ ] Test account creation
- [ ] Test funding with card
- [ ] Test funding with bank
- [ ] Test transaction history
- [ ] Test in light mode
- [ ] Test in dark mode
- [ ] Test on mobile device
- [ ] Test on tablet
- [ ] Test on desktop
- [ ] Test in Chrome
- [ ] Test in Firefox
- [ ] Test in Safari
- [ ] Test with screen reader
- [ ] Test keyboard navigation
- [ ] Test with network throttling
- [ ] Test error scenarios
- [ ] Test validation messages

---

## End of Testing Guide
