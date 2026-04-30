import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "data";
const DATA_FILE = path.join(DATA_DIR, "state.json");

export type GuildSettings = {
  guild_id: string;
  category_id: string | null;
  log_channel_id: string | null;
  support_role_id: string | null;
  panel_message: string;
  ticket_counter: number;
};

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

type State = {
  guildSettings: Record<string, GuildSettings>;
  tickets: Ticket[];
  nextTicketId: number;
};

let state: State = {
  guildSettings: {},
  tickets: [],
  nextTicketId: 1,
};

let saveTimer: NodeJS.Timeout | null = null;

async function saveState() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save state", err);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveState();
  }, 500);
}

export async function initSchema() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as State;
    state = {
      guildSettings: parsed.guildSettings || {},
      tickets: (parsed.tickets || []).map((t) => ({
        ...t,
        created_at: new Date(t.created_at),
        closed_at: t.closed_at ? new Date(t.closed_at) : null,
      })),
      nextTicketId: parsed.nextTicketId || 1,
    };
    console.log(
      `📦 تم تحميل ${Object.keys(state.guildSettings).length} إعدادات و ${state.tickets.length} تذكرة`,
    );
  } catch {
    console.log("📦 لا توجد بيانات سابقة، سيتم إنشاء حالة جديدة");
  }
}

export async function getSettings(guildId: string): Promise<GuildSettings> {
  let s = state.guildSettings[guildId];
  if (!s) {
    s = {
      guild_id: guildId,
      category_id: null,
      log_channel_id: null,
      support_role_id: null,
      panel_message: "اضغط الزر بالأسفل لفتح تذكرة دعم.",
      ticket_counter: 0,
    };
    state.guildSettings[guildId] = s;
    scheduleSave();
  }
  return s;
}

export async function updateSettings(
  guildId: string,
  patch: Partial<Omit<GuildSettings, "guild_id" | "ticket_counter">>,
) {
  const s = await getSettings(guildId);
  Object.assign(s, patch);
  scheduleSave();
}

export async function nextTicketNumber(guildId: string): Promise<number> {
  const s = await getSettings(guildId);
  s.ticket_counter += 1;
  scheduleSave();
  return s.ticket_counter;
}

export async function createTicketRow(
  guildId: string,
  channelId: string,
  ownerId: string,
  number: number,
): Promise<Ticket> {
  const ticket: Ticket = {
    id: state.nextTicketId++,
    guild_id: guildId,
    channel_id: channelId,
    owner_id: ownerId,
    claimer_id: null,
    number,
    status: "open",
    created_at: new Date(),
    closed_at: null,
  };
  state.tickets.push(ticket);
  scheduleSave();
  return ticket;
}

export async function getTicketByChannel(
  channelId: string,
): Promise<Ticket | null> {
  return state.tickets.find((t) => t.channel_id === channelId) ?? null;
}

export async function getOpenTicketByOwner(
  guildId: string,
  ownerId: string,
): Promise<Ticket | null> {
  return (
    state.tickets.find(
      (t) =>
        t.guild_id === guildId &&
        t.owner_id === ownerId &&
        t.status === "open",
    ) ?? null
  );
}

export async function claimTicket(channelId: string, claimerId: string) {
  const t = state.tickets.find((x) => x.channel_id === channelId);
  if (t) {
    t.claimer_id = claimerId;
    scheduleSave();
  }
}

export async function closeTicketRow(channelId: string) {
  const t = state.tickets.find((x) => x.channel_id === channelId);
  if (t) {
    t.status = "closed";
    t.closed_at = new Date();
    scheduleSave();
  }
}
