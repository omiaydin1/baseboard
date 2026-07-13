import { createClient } from "@libsql/client";

export interface TursoConfig {
  url: string;
  authToken: string;
}

function loadConfig(): TursoConfig | null {
  const url = process.env.TURSO_DB_URL;
  const authToken = process.env.TURSO_DB_AUTH_TOKEN;
  if (!url || !authToken) return null;
  return { url, authToken };
}

let _client: ReturnType<typeof createClient> | null = null;
let _schemaEnsured = false;
let _clientUrl = "";
let _clientToken = "";

function safeNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export async function getTursoClient(): Promise<ReturnType<typeof createClient> | null> {
  const cfg = loadConfig();
  if (!cfg) return null;
  if (!_client || _clientUrl !== cfg.url || _clientToken !== cfg.authToken) {
    _client = createClient({ url: cfg.url, authToken: cfg.authToken });
    _clientUrl = cfg.url;
    _clientToken = cfg.authToken;
    _schemaEnsured = false;
  }
  if (!_schemaEnsured) {
    await ensureSchema(_client);
    _schemaEnsured = true;
  }
  return _client;
}

/** Check whether Turso is configured and reachable. */
export function isTursoConfigured(): boolean {
  return loadConfig() !== null;
}

const PLOTS_TABLE = `
CREATE TABLE IF NOT EXISTS plots (
  plot_id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  price TEXT NOT NULL,
  is_for_sale INTEGER NOT NULL DEFAULT 0,
  image_uri TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
)
`;

const PURCHASES_TABLE = `
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  buyer TEXT NOT NULL,
  count INTEGER NOT NULL,
  timestamp INTEGER NOT NULL
)
`;

const BASENAMES_TABLE = `
CREATE TABLE IF NOT EXISTS basenames (
  address TEXT PRIMARY KEY,
  basename TEXT,
  updated_at INTEGER NOT NULL
)
`;

const INDEXER_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
`;

const PURCHASES_INDEX = `
CREATE INDEX IF NOT EXISTS idx_purchases_block ON purchases(block_number DESC)
`;

const PLOTS_OWNER_INDEX = `
CREATE INDEX IF NOT EXISTS idx_plots_owner ON plots(owner)
`;

const PLOTS_FOR_SALE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_plots_for_sale ON plots(is_for_sale) WHERE is_for_sale = 1
`;

const PURCHASES_BUYER_INDEX = `
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer)
`;

const PLOTS_UPDATED_AT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_plots_updated_at ON plots(updated_at)
`;

export async function ensureSchema(client: ReturnType<typeof createClient>): Promise<void> {
  await client.batch([
    PLOTS_TABLE,
    PURCHASES_TABLE,
    BASENAMES_TABLE,
    INDEXER_STATE_TABLE,
    PURCHASES_INDEX,
    PLOTS_OWNER_INDEX,
    PLOTS_FOR_SALE_INDEX,
    PURCHASES_BUYER_INDEX,
    PLOTS_UPDATED_AT_INDEX,
  ], "write");
}

export async function getLastScannedBlock(client: ReturnType<typeof createClient>): Promise<number> {
  const rs = await client.execute({
    sql: "SELECT value FROM indexer_state WHERE key = ?",
    args: ["last_scanned_block"],
  });
  if (rs.rows.length === 0) return 0;
  return safeNumber(rs.rows[0].value);
}

export async function setLastScannedBlock(
  client: ReturnType<typeof createClient>,
  block: number,
): Promise<void> {
  await client.execute({
    sql: "INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?, ?)",
    args: ["last_scanned_block", String(block)],
  });
}

export async function upsertPlot(
  client: ReturnType<typeof createClient>,
  plotId: number,
  owner: string,
  price: string,
  isForSale: boolean,
  imageUri: string,
  updatedAt: number,
): Promise<void> {
  await client.execute({
    sql: `INSERT OR REPLACE INTO plots (plot_id, owner, price, is_for_sale, image_uri, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [plotId, owner.toLowerCase(), price, isForSale ? 1 : 0, imageUri, updatedAt],
  });
}

export async function insertPurchase(
  client: ReturnType<typeof createClient>,
  blockNumber: number,
  txHash: string,
  buyer: string,
  count: number,
  timestamp: number,
): Promise<void> {
  await client.execute({
    sql: "INSERT INTO purchases (block_number, tx_hash, buyer, count, timestamp) VALUES (?, ?, ?, ?, ?)",
    args: [blockNumber, txHash, buyer.toLowerCase(), count, timestamp],
  });
}

export async function upsertBasename(
  client: ReturnType<typeof createClient>,
  address: string,
  basename: string | null,
  updatedAt: number,
): Promise<void> {
  await client.execute({
    sql: "INSERT OR REPLACE INTO basenames (address, basename, updated_at) VALUES (?, ?, ?)",
    args: [address.toLowerCase(), basename, updatedAt],
  });
}

export async function getBasenames(
  client: ReturnType<typeof createClient>,
  addresses: string[],
): Promise<Map<string, string | null>> {
  if (addresses.length === 0) return new Map();
  const placeholders = addresses.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT address, basename FROM basenames WHERE address IN (${placeholders})`,
    args: addresses,
  });
  const result = new Map<string, string | null>();
  for (const row of rs.rows) {
    result.set(row.address as string, (row.basename as string) ?? null);
  }
  return result;
}

export async function getLeaderboard(
  client: ReturnType<typeof createClient>,
  limit = 100,
): Promise<Array<{ owner: string; count: number; tieBreakBlock: number; rank: number; baseName: string | null }>> {
  const rs = await client.execute({
    sql: `SELECT p.owner,
                 COUNT(DISTINCT p.plot_id) AS cnt,
                 MIN(pp.block_number) AS tie_break_block,
                 b.basename AS base_name
          FROM plots p
          LEFT JOIN purchases pp ON pp.buyer = p.owner
          LEFT JOIN basenames b ON b.address = p.owner
          WHERE p.owner != '0x0000000000000000000000000000000000000000'
          GROUP BY p.owner
          ORDER BY cnt DESC, tie_break_block ASC
          LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((row, i) => ({
    owner: row.owner as string,
    count: safeNumber(row.cnt),
    tieBreakBlock: safeNumber(row.tie_break_block, Number.MAX_SAFE_INTEGER),
    rank: i + 1,
    baseName: (row.base_name as string) ?? null,
  }));
}

export async function getRecentPurchases(
  client: ReturnType<typeof createClient>,
  limit = 20,
): Promise<Array<{ buyer: string; count: number; block: number; txHash: string }>> {
  const rs = await client.execute({
    sql: "SELECT block_number, tx_hash, buyer, count FROM purchases ORDER BY block_number DESC LIMIT ?",
    args: [limit],
  });
  return rs.rows.map((row) => ({
    buyer: row.buyer as string,
    count: Number(row.count),
    block: Number(row.block_number),
    txHash: row.tx_hash as string,
  }));
}

export async function getTotalPlotsSold(
  client: ReturnType<typeof createClient>,
): Promise<number> {
  const rs = await client.execute(
    "SELECT COUNT(*) AS cnt FROM plots WHERE owner != '0x0000000000000000000000000000000000000000'",
  );
  return safeNumber(rs.rows[0]?.cnt);
}

export async function getPlotBatch(
  client: ReturnType<typeof createClient>,
  plotIds: number[],
): Promise<Array<{ plotId: number; owner: string; price: string; isForSale: boolean; imageUri: string }>> {
  if (plotIds.length === 0) return [];
  // SQLite has a limit of ~999 parameters — chunk to stay safe.
  const CHUNK_SIZE = 900;
  const results: Array<{ plotId: number; owner: string; price: string; isForSale: boolean; imageUri: string }> = [];
  for (let i = 0; i < plotIds.length; i += CHUNK_SIZE) {
    const chunk = plotIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const rs = await client.execute({
      sql: `SELECT plot_id, owner, price, is_for_sale, image_uri FROM plots WHERE plot_id IN (${placeholders})`,
      args: chunk.map(String),
    });
    for (const row of rs.rows) {
      results.push({
        plotId: Number(row.plot_id),
        owner: row.owner as string,
        price: row.price as string,
        isForSale: Number(row.is_for_sale) === 1,
        imageUri: row.image_uri as string,
      });
    }
  }
  return results;
}

const GET_ALL_PLOTS_LIMIT = 1000;

export async function getAllPlots(
  client: ReturnType<typeof createClient>,
  since?: number,
): Promise<Array<{ plotId: number; owner: string; price: string; isForSale: boolean; imageUri: string }>> {
  let sql: string;
  let args: (string | number)[];
  if (since) {
    sql = "SELECT plot_id, owner, price, is_for_sale, image_uri FROM plots WHERE owner != '0x0000000000000000000000000000000000000000' AND updated_at >= ? LIMIT ?";
    args = [since, GET_ALL_PLOTS_LIMIT];
  } else {
    sql = "SELECT plot_id, owner, price, is_for_sale, image_uri FROM plots WHERE owner != '0x0000000000000000000000000000000000000000' LIMIT ?";
    args = [GET_ALL_PLOTS_LIMIT];
  }
  const rs = await client.execute({ sql, args });
  return rs.rows.map((row) => ({
    plotId: Number(row.plot_id),
    owner: row.owner as string,
    price: row.price as string,
    isForSale: Number(row.is_for_sale) === 1,
    imageUri: row.image_uri as string,
  }));
}
