import "dotenv/config";

// Every test talks to the test database, never the dev database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// A fixed, test-only encryption key, so token tests never need the real one.
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
