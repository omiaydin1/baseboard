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

export function getTursoClient(): ReturnType<typeof createClient> | null {
  if (_client) return _client;
  const cfg = loadConfig();
  if (!cfg) return null;
  _client = createClient({ url: cfg.url, authToken: cfg.authToken });
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

export async function ensureSchema(client: ReturnType<typeof createClient>): Promise<void> {
  await client.execute(PLOTS_TABLE);
  await client.execute(PURCHASES_TABLE);
  await client.execute(BASENAMES_TABLE);
  await client.execute(INDEXER_STATE_TABLE);
  await client.execute(PURCHASES_INDEX);
  await client.execute(PLOTS_OWNER_INDEX);
  await client.execute(PLOTS_FOR_SALE_INDEX);
}

export async function getLastScannedBlock(client: ReturnType<typeof createClient>): Promise<number> {
  const rs = await client.execute({
    sql: "SELECT value FROM indexer_state WHERE key = ?",
    args: ["last_scanned_block"],
  });
  if (rs.rows.length === 0) return 0;
  return Number(rs.rows[0].value);
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
                 COUNT(*) AS cnt,
                 COALESCE(
                   (SELECT MIN(pp.block_number) FROM purchases pp
                     WHERE pp.buyer = p.owner AND pp.timestamp <= (
                       SELECT MAX(pp2.timestamp) FROM purchases pp2 WHERE pp2.buyer = p.owner
                     )
                   ),
                   (SELECT MIN(pp3.block_number) FROM purchases pp3 WHERE pp3.buyer = p.owner)
                 ) AS tie_break_block,
                 b.basename AS base_name
          FROM plots p
          LEFT JOIN basenames b ON b.address = p.owner
          WHERE p.owner != '0x0000000000000000000000000000000000000000'
          GROUP BY p.owner
          ORDER BY cnt DESC, tie_break_block ASC
          LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((row, i) => ({
    owner: row.owner as string,
    count: Number(row.cnt),
    tieBreakBlock: Number(row.tie_break_block ?? Number.MAX_SAFE_INTEGER),
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
  return Number(rs.rows[0]?.cnt ?? 0);
}

export async function getPlotBatch(
  client: ReturnType<typeof createClient>,
  plotIds: number[],
): Promise<Array<{ plotId: number; owner: string; price: string; isForSale: boolean; imageUri: string }>> {
  if (plotIds.length === 0) return [];
  const placeholders = plotIds.map(() => "?").join(",");
  const rs = await client.execute({
    sql: `SELECT plot_id, owner, price, is_for_sale, image_uri FROM plots WHERE plot_id IN (${placeholders})`,
    args: plotIds.map(String),
  });
  return rs.rows.map((row) => ({
    plotId: Number(row.plot_id),
    owner: row.owner as string,
    price: row.price as string,
    isForSale: Number(row.is_for_sale) === 1,
    imageUri: row.image_uri as string,
  }));
}

export async function getAllPlots(
  client: ReturnType<typeof createClient>,
): Promise<Array<{ plotId: number; owner: string; price: string; isForSale: boolean; imageUri: string }>> {
  const rs = await client.execute(
    "SELECT plot_id, owner, price, is_for_sale, image_uri FROM plots WHERE owner != '0x0000000000000000000000000000000000000000'",
  );
  return rs.rows.map((row) => ({
    plotId: Number(row.plot_id),
    owner: row.owner as string,
    price: row.price as string,
    isForSale: Number(row.is_for_sale) === 1,
    imageUri: row.image_uri as string,
  }));
}
