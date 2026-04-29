import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Interaction,
  type TextChannel,
  type CategoryChannel,
  type GuildMember,
  MessageFlags,
} from "discord.js";
import {
  initSchema,
  getSettings,
  updateSettings,
  nextTicketNumber,
  createTicketRow,
  getTicketByChannel,
  getOpenTicketByOwner,
  claimTicket,
  closeTicketRow,
} from "./db.js";
import { buildTranscript } from "./transcript.js";

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  throw new Error("DISCORD_TOKEN env var is required");
}

const wantMessageContent =
  process.env.DISCORD_MESSAGE_CONTENT_INTENT === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    ...(wantMessageContent ? [GatewayIntentBits.MessageContent] : []),
  ],
  partials: [Partials.Channel],
});

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد نظام التذاكر")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((o) =>
      o
        .setName("category")
        .setDescription("التصنيف الذي تُنشأ فيه التذاكر")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName("log_channel")
        .setDescription("قناة سجلات التذاكر")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addRoleOption((o) =>
      o
        .setName("support_role")
        .setDescription("رتبة الدعم الفني")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("نشر لوحة فتح التذاكر في القناة الحالية")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("message")
        .setDescription("نص يظهر فوق الزر (اختياري)")
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("add")
    .setDescription("إضافة عضو إلى التذكرة الحالية")
    .addUserOption((o) =>
      o.setName("user").setDescription("العضو المراد إضافته").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("إزالة عضو من التذكرة الحالية")
    .addUserOption((o) =>
      o.setName("user").setDescription("العضو المراد إزالته").setRequired(true),
    ),
].map((c) => c.toJSON());

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ تم تسجيل الدخول كـ ${c.user.tag}`);
  await initSchema();
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
  console.log("✅ تم تسجيل أوامر السلاش");
});

function panelEmbed(message: string) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 نظام التذاكر")
    .setDescription(message)
    .setFooter({ text: "اضغط الزر أدناه لفتح تذكرة جديدة" });
}

function panelRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:create")
      .setLabel("فتح تذكرة")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary),
  );
}

function ticketControlsRow(claimed: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:claim")
      .setLabel(claimed ? "تم الاستلام" : "استلام")
      .setEmoji("🙋")
      .setStyle(claimed ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(claimed),
    new ButtonBuilder()
      .setCustomId("ticket:close")
      .setLabel("إغلاق")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );
}

function closeConfirmRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket:close_confirm")
      .setLabel("تأكيد الإغلاق")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ticket:close_cancel")
      .setLabel("إلغاء")
      .setStyle(ButtonStyle.Secondary),
  );
}

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;
      if (!interaction.guild) {
        await interaction.reply({
          content: "هذا الأمر يُستخدم داخل السيرفر فقط.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (commandName === "setup") {
        const category = interaction.options.getChannel("category", true);
        const logChannel = interaction.options.getChannel("log_channel", true);
        const supportRole = interaction.options.getRole("support_role", true);
        await updateSettings(interaction.guild.id, {
          category_id: category.id,
          log_channel_id: logChannel.id,
          support_role_id: supportRole.id,
        });
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("✅ تم حفظ الإعدادات")
              .addFields(
                { name: "تصنيف التذاكر", value: `<#${category.id}>` },
                { name: "قناة السجلات", value: `<#${logChannel.id}>` },
                { name: "رتبة الدعم", value: `<@&${supportRole.id}>` },
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (commandName === "panel") {
        const settings = await getSettings(interaction.guild.id);
        if (
          !settings.category_id ||
          !settings.log_channel_id ||
          !settings.support_role_id
        ) {
          await interaction.reply({
            content: "❌ يجب تشغيل أمر `/setup` أولاً.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const message =
          interaction.options.getString("message") ?? settings.panel_message;
        await updateSettings(interaction.guild.id, { panel_message: message });
        const channel = interaction.channel as TextChannel;
        await channel.send({
          embeds: [panelEmbed(message)],
          components: [panelRow()],
        });
        await interaction.reply({
          content: "✅ تم نشر اللوحة.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (commandName === "add" || commandName === "remove") {
        const ticket = await getTicketByChannel(interaction.channelId);
        if (!ticket || ticket.status !== "open") {
          await interaction.reply({
            content: "❌ هذا الأمر يُستخدم داخل قناة تذكرة مفتوحة فقط.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const user = interaction.options.getUser("user", true);
        const channel = interaction.channel as TextChannel;
        if (commandName === "add") {
          await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
          });
          await interaction.reply(`✅ تمت إضافة <@${user.id}> للتذكرة.`);
        } else {
          await channel.permissionOverwrites.delete(user.id);
          await interaction.reply(`✅ تمت إزالة <@${user.id}> من التذكرة.`);
        }
        return;
      }
    }

    if (!interaction.isButton()) return;
    if (!interaction.guild) return;

    if (interaction.customId === "ticket:create") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const settings = await getSettings(interaction.guild.id);
      if (
        !settings.category_id ||
        !settings.log_channel_id ||
        !settings.support_role_id
      ) {
        await interaction.editReply(
          "❌ نظام التذاكر غير مُعد بعد. اطلب من إداري تشغيل `/setup`.",
        );
        return;
      }

      const existing = await getOpenTicketByOwner(
        interaction.guild.id,
        interaction.user.id,
      );
      if (existing) {
        const cooldownEndsMs =
          existing.created_at.getTime() + 24 * 60 * 60 * 1000;
        const cooldownEndsSec = Math.floor(cooldownEndsMs / 1000);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("⏳ لديك تذكرة مفتوحة")
              .setDescription(
                `لديك تذكرة مفتوحة بالفعل: <#${existing.channel_id}>\n\n` +
                  `لا يمكنك فتح تذكرة جديدة حتى:\n` +
                  `• تنتهي مدة الانتظار <t:${cooldownEndsSec}:R> (<t:${cooldownEndsSec}:f>)\n` +
                  `• أو يتم إغلاق تذكرتك الحالية`,
              ),
          ],
        });
        return;
      }

      const category = (await interaction.guild.channels.fetch(
        settings.category_id,
      )) as CategoryChannel | null;
      if (!category) {
        await interaction.editReply(
          "❌ لم يتم العثور على تصنيف التذاكر. أعد ضبط `/setup`.",
        );
        return;
      }

      const number = await nextTicketNumber(interaction.guild.id);
      const channel = await interaction.guild.channels.create({
        name: `ticket-${number.toString().padStart(4, "0")}`,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `تذكرة لـ <@${interaction.user.id}>`,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
            ],
          },
          {
            id: settings.support_role_id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.ManageMessages,
            ],
          },
          {
            id: client.user!.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });

      await createTicketRow(
        interaction.guild.id,
        channel.id,
        interaction.user.id,
        number,
      );

      const welcome = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎫 تذكرة #${number}`)
        .setDescription(
          `أهلاً <@${interaction.user.id}>!\nاكتب تفاصيل طلبك وسيتم الرد عليك قريباً.`,
        )
        .addFields(
          { name: "صاحب التذكرة", value: `<@${interaction.user.id}>`, inline: true },
          { name: "الحالة", value: "مفتوحة", inline: true },
        );

      await channel.send({
        content: `<@${interaction.user.id}> <@&${settings.support_role_id}>`,
        embeds: [welcome],
        components: [ticketControlsRow(false)],
      });

      await interaction.editReply(`✅ تم فتح تذكرتك: <#${channel.id}>`);
      return;
    }

    if (interaction.customId === "ticket:claim") {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket || ticket.status !== "open") {
        await interaction.reply({
          content: "❌ هذه التذكرة غير موجودة أو مغلقة.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const settings = await getSettings(interaction.guild.id);
      const member = interaction.member as GuildMember;
      const isSupport =
        settings.support_role_id &&
        member.roles.cache.has(settings.support_role_id);
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isSupport && !isAdmin) {
        await interaction.reply({
          content: "❌ هذا الزر مخصص لفريق الدعم فقط.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (ticket.claimer_id) {
        await interaction.reply({
          content: `❌ التذكرة مستلمة من قبل <@${ticket.claimer_id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await claimTicket(interaction.channelId, interaction.user.id);
      await interaction.message.edit({
        components: [ticketControlsRow(true)],
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setDescription(`🙋 تم استلام التذكرة بواسطة <@${interaction.user.id}>`),
        ],
      });
      return;
    }

    if (interaction.customId === "ticket:close") {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket || ticket.status !== "open") {
        await interaction.reply({
          content: "❌ هذه التذكرة غير موجودة أو مغلقة.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription("هل أنت متأكد من إغلاق التذكرة؟"),
        ],
        components: [closeConfirmRow()],
      });
      return;
    }

    if (interaction.customId === "ticket:close_cancel") {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x99aab5)
            .setDescription("تم إلغاء الإغلاق."),
        ],
        components: [],
      });
      return;
    }

    if (interaction.customId === "ticket:close_confirm") {
      const ticket = await getTicketByChannel(interaction.channelId);
      if (!ticket || ticket.status !== "open") {
        await interaction.reply({
          content: "❌ هذه التذكرة غير موجودة أو مغلقة.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription("🔒 جاري إغلاق التذكرة وحفظ السجل..."),
        ],
        components: [],
      });

      const channel = interaction.channel as TextChannel;
      const settings = await getSettings(interaction.guild.id);

      let transcript;
      try {
        transcript = await buildTranscript(channel);
      } catch (err) {
        console.error("Failed to build transcript", err);
      }

      await closeTicketRow(channel.id);

      if (settings.log_channel_id) {
        try {
          const logChannel = (await interaction.guild.channels.fetch(
            settings.log_channel_id,
          )) as TextChannel | null;
          if (logChannel) {
            const owner = await interaction.guild.members
              .fetch(ticket.owner_id)
              .catch(() => null);
            const claimer = ticket.claimer_id
              ? await interaction.guild.members
                  .fetch(ticket.claimer_id)
                  .catch(() => null)
              : null;
            const embed = new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle(`📁 سجل التذكرة #${ticket.number}`)
              .addFields(
                {
                  name: "صاحب التذكرة",
                  value: owner ? `<@${owner.id}>` : `\`${ticket.owner_id}\``,
                  inline: true,
                },
                {
                  name: "المُستلم",
                  value: claimer ? `<@${claimer.id}>` : "لم يُستلم",
                  inline: true,
                },
                {
                  name: "أُغلقت بواسطة",
                  value: `<@${interaction.user.id}>`,
                  inline: true,
                },
                {
                  name: "فُتحت في",
                  value: `<t:${Math.floor(ticket.created_at.getTime() / 1000)}:f>`,
                  inline: true,
                },
                {
                  name: "أُغلقت في",
                  value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                  inline: true,
                },
              );
            await logChannel.send({
              embeds: [embed],
              files: transcript ? [transcript] : [],
            });
          }
        } catch (err) {
          console.error("Failed to send log", err);
        }
      }

      setTimeout(() => {
        channel.delete("Ticket closed").catch((err) =>
          console.error("Failed to delete channel", err),
        );
      }, 3000);
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction
        .reply({
          content: "❌ حدث خطأ أثناء تنفيذ العملية.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
});

client.login(TOKEN);
