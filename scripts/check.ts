import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DB_URL!,
    authToken: process.env.TURSO_DB_AUTH_TOKEN!,
  });
  const r = await c.execute("SELECT COUNT(*) AS cnt FROM plots");
  console.log("toplam plot:", r.rows[0].cnt);
  const r2 = await c.execute("SELECT value FROM indexer_state WHERE key = 'last_scanned_block'");
  console.log("lastScannedBlock:", r2.rows[0]?.value);
}

main().catch(console.error);
