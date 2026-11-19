import "dotenv/config";

// Every test talks to the test database, never the dev database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// A fixed, test-only encryption key, so token tests never need the real one.
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

// QuickBooks settings for tests: never the real keys from .env. Every test
// that talks to "QuickBooks" passes the fake in tests/helpers/fake-qbo.ts.
process.env.QBO_CLIENT_ID = "test-client-id";
process.env.QBO_CLIENT_SECRET = "test-client-secret";
process.env.QBO_REDIRECT_URI = "http://localhost:3000/api/qbo/callback";
process.env.QBO_ENVIRONMENT = "sandbox";
delete process.env.AUTH_RESEND_KEY;
delete process.env.EMAIL_FROM;
delete process.env.SYNC_START_DATE;
