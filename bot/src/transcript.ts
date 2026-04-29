import {
  type TextChannel,
  ChannelType,
  AttachmentBuilder,
} from "discord.js";

export async function buildTranscript(
  channel: TextChannel,
): Promise<AttachmentBuilder> {
  if (channel.type !== ChannelType.GuildText) {
    throw new Error("Channel is not a text channel");
  }

  const collected: {
    author: string;
    authorId: string;
    content: string;
    createdAt: Date;
    attachments: string[];
  }[] = [];

  let lastId: string | undefined;
  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });
    if (batch.size === 0) break;
    for (const msg of batch.values()) {
      collected.push({
        author: msg.author.tag,
        authorId: msg.author.id,
        content: msg.content,
        createdAt: msg.createdAt,
        attachments: Array.from(msg.attachments.values()).map((a) => a.url),
      });
    }
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  collected.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rows = collected
    .map(
      (m) => `
    <div class="msg">
      <div class="meta">
        <span class="author">${escape(m.author)}</span>
        <span class="date">${m.createdAt.toLocaleString("ar-SA")}</span>
      </div>
      <div class="content">${escape(m.content || "")}</div>
      ${
        m.attachments.length
          ? `<div class="atts">${m.attachments
              .map(
                (a) =>
                  `<a href="${escape(a)}" target="_blank">${escape(a)}</a>`,
              )
              .join("<br>")}</div>`
          : ""
      }
    </div>`,
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<title>سجل التذكرة - ${escape(channel.name)}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background:#2c2f33; color:#dcddde; margin:0; padding:24px; }
  h1 { color:#fff; border-bottom:1px solid #4f545c; padding-bottom:8px; }
  .msg { background:#36393f; border-radius:6px; padding:12px 16px; margin-bottom:8px; }
  .meta { display:flex; gap:12px; margin-bottom:6px; }
  .author { color:#fff; font-weight:bold; }
  .date { color:#72767d; font-size:12px; }
  .content { white-space:pre-wrap; word-wrap:break-word; }
  .atts { margin-top:8px; font-size:12px; color:#00b0f4; }
  .atts a { color:#00b0f4; }
</style>
</head>
<body>
  <h1>سجل التذكرة - ${escape(channel.name)}</h1>
  <p>عدد الرسائل: ${collected.length}</p>
  ${rows}
</body>
</html>`;

  return new AttachmentBuilder(Buffer.from(html, "utf-8"), {
    name: `transcript-${channel.name}.html`,
  });
}
