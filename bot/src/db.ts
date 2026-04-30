import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const needsSsl =
  /neon\.tech|supabase|render\.com|amazonaws|sslmode=require/.test(
    process.env.DATABASE_URL,
  );

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      category_id TEXT,
      log_channel_id TEXT,
      support_role_id TEXT,
      panel_message TEXT DEFAULT 'اضغط الزر بالأسفل لفتح تذكرة دعم.',
      ticket_counter INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      claimer_id TEXT,
      number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS tickets_owner_open
    ON tickets (guild_id, owner_id) WHERE status = 'open';
  `);
}

export type GuildSettings = {
  guild_id: string;
  category_id: string | null;
  log_channel_id: string | null;
  support_role_id: string | null;
  panel_message: string;
  ticket_counter: number;
};

export async function getSettings(guildId: string): Promise<GuildSettings> {
  const res = await pool.query<GuildSettings>(
    "SELECT * FROM guild_settings WHERE guild_id = $1",
    [guildId],
  );
  if (res.rows.length > 0) return res.rows[0];
  const inserted = await pool.query<GuildSettings>(
    "INSERT INTO guild_settings (guild_id) VALUES ($1) RETURNING *",
    [guildId],
  );
  return inserted.rows[0];
}

export async function updateSettings(
  guildId: string,
  patch: Partial<Omit<GuildSettings, "guild_id" | "ticket_counter">>,
) {
  await getSettings(guildId);
  const fields: string[] = [];
  const values: (string | null)[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = $${i++}`);
    values.push(value as string | null);
  }
  if (fields.length === 0) return;
  values.push(guildId);
  await pool.query(
    `UPDATE guild_settings SET ${fields.join(", ")} WHERE guild_id = $${i}`,
    values,
  );
}

export async function nextTicketNumber(guildId: string): Promise<number> {
  const res = await pool.query<{ ticket_counter: number }>(
    `UPDATE guild_settings SET ticket_counter = ticket_counter + 1
     WHERE guild_id = $1 RETURNING ticket_counter`,
    [guildId],
  );
  return res.rows[0].ticket_counter;
}

export type Ticket = {
  id: number;
  guild_id: string;
  channel_id: string;
  owner_id: string;
  claimer_id: string | null;
  number: number;
  status: string;
  created_at: Date;
  closed_at: Date | null;
};

export async function createTicketRow(
  guildId: string,
  channelId: string,
  ownerId: string,
  number: number,
): Promise<Ticket> {
  const res = await pool.query<Ticket>(
    `INSERT INTO tickets (guild_id, channel_id, owner_id, number)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [guildId, channelId, ownerId, number],
  );
  return res.rows[0];
}

export async function getTicketByChannel(
  channelId: string,
): Promise<Ticket | null> {
  const res = await pool.query<Ticket>(
    "SELECT * FROM tickets WHERE channel_id = $1",
    [channelId],
  );
  return res.rows[0] ?? null;
}

export async function getOpenTicketByOwner(
  guildId: string,
  ownerId: string,
): Promise<Ticket | null> {
  const res = await pool.query<Ticket>(
    `SELECT * FROM tickets
     WHERE guild_id = $1 AND owner_id = $2 AND status = 'open'
     LIMIT 1`,
    [guildId, ownerId],
  );
  return res.rows[0] ?? null;
}

export async function claimTicket(channelId: string, claimerId: string) {
  await pool.query(
    "UPDATE tickets SET claimer_id = $1 WHERE channel_id = $2",
    [claimerId, channelId],
  );
}

export async function closeTicketRow(channelId: string) {
  await pool.query(
    `UPDATE tickets SET status = 'closed', closed_at = NOW()
     WHERE channel_id = $1`,
    [channelId],
  );
}
