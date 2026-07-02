import { createClient } from "@libsql/client";

const tursoUrl = process.env.TURSO_DATABASE_URL || "";
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || "";

let _client: ReturnType<typeof createClient> | null = null;

export function getTurso() {
  if (!tursoUrl || !tursoAuthToken) return null;
  if (!_client) {
    _client = createClient({
      url: tursoUrl,
      authToken: tursoAuthToken,
    });
  }
  return _client;
}

export function ensureTurso() {
  const db = getTurso();
  if (!db) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not configured");
  return db;
}
