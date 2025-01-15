/********************************************************************
 *                              IMPORTS
 ********************************************************************/
import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import Decimal from "decimal.js";
import {
  ActionRowBuilder,
  APIInteractionGuildMember,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Guild,
  GuildMember,
  GuildMemberRoleManager,
  REST,
  Role,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import { scheduleJob } from "node-schedule";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { v4 } from "uuid";
import { Database } from "./types/supabase";

/********************************************************************
 *                       SUPABASE SETUP
 ********************************************************************/
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;
export const supabase = createClient<Database>(supabaseUrl, supabaseKey);

/********************************************************************
 *                       DISCORD CLIENT
 ********************************************************************/
const discordBotToken = process.env.DISCORD_BOT_TOKEN;
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  presence: {
    status: 'online',
    activities: [
      {
        name: 'moola war',
        type: 0, // "Playing"
      },
    ],
  },
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

/********************************************************************
 *                     ROLE CONSTANTS
 ********************************************************************/
/**  
 *  Replace these with your actual role IDs from the Discord server.  
 */
const WHITELIST_ROLE_ID        = "1263470313300295751";
const MOOLALIST_ROLE_ID        = "1263470568536014870";
const FREE_MINT_ROLE_ID        = "1328473525710884864";       // Free Mint Role
const FREE_MINT_WINNER_ROLE_ID = "1263470790314164325";       // Free Mint Winner Role
const MOOTARD_ROLE_ID          = "1281979123534925967";
const NEW_WANKME_ROLE_ID       = "1328471474947883120";
const WL_WINNER_ROLE_ID        = "1264963781419597916";
const ML_WINNER_ROLE_ID        = "1267532607491407933";
const BULL_ROLE_ID             = "1230207362145452103";
const BEAR_ROLE_ID             = "1230207106896892006";

// Admin role IDs
const ADMIN_ROLE_IDS = [
  "1230906668066406481",
  "1230195803877019718",
  "1230906465334853785",
  "1234239721165815818",
];

/********************************************************************
 *                     HELPER FUNCTIONS
 ********************************************************************/
/** Check if the user has an admin role. */
function hasAdminRole(member: GuildMember | APIInteractionGuildMember | null) {
  if (member && "roles" in member && member.roles instanceof GuildMemberRoleManager) {
    return member.roles.cache.some((role: Role) => ADMIN_ROLE_IDS.includes(role.id));
  }
  return false;
}

/** Mask a wallet address for display purposes. */
export const maskAddress = (address: string) => {
  if (!address || address.length < 8) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

/********************************************************************
 *              TEAM POINTS & TOP PLAYERS HELPERS
 ********************************************************************/
async function getTeamPoints() {
  const [bullasData, berasData] = await Promise.all([
    supabase.rpc("sum_points_for_team", { team_name: "bullas" }),
    supabase.rpc("sum_points_for_team", { team_name: "beras" }),
  ]);

  return {
    bullas: bullasData.data ?? 0,
    beras: berasData.data ?? 0,
  };
}

async function getTopPlayers(team: string, limit: number) {
  const { data, error } = await supabase
    .from("users")
    .select("discord_id, address, points")
    .eq("team", team)
    .order("points", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
// updaterolesfunction

async function updateWhitelistRoles(
  guild: Guild,
  teamType: 'winning' | 'losing',
  threshold: number,
  isSimulation: boolean = false
) {
  console.log(`${isSimulation ? 'Simulating' : 'Starting'} whitelist role update for ${teamType} team...`);

  let roleUpdateLog = {
    added: 0,
    existing: 0
  };

  const whitelistRole = guild.roles.cache.get(WHITELIST_ROLE_ID);
  const wlWinnerRole = guild.roles.cache.get(WL_WINNER_ROLE_ID);

  if (!whitelistRole || !wlWinnerRole) {
    console.error("Whitelist roles not found. Aborting role update.");
    return roleUpdateLog;
  }

  const teamPoints = await getTeamPoints();
  const winningTeam = teamPoints.bullas > teamPoints.beras ? "bullas" : "beras";
  const targetTeam = teamType === "winning" ? winningTeam : winningTeam === "bullas" ? "beras" : "bullas";

  const { data: players, error } = await supabase
    .from("users")
    .select("discord_id, points, team")
    .eq("team", targetTeam);

  if (error) {
    console.error("Error fetching players:", error);
    return roleUpdateLog;
  }

  for (const player of players) {
    if (player.discord_id) {
      try {
        const member = await guild.members.fetch(player.discord_id);
        if (member && player.points >= threshold) {
          if (!member.roles.cache.has(WHITELIST_ROLE_ID) && !member.roles.cache.has(WL_WINNER_ROLE_ID)) {
            if (!isSimulation) {
              await member.roles.add(whitelistRole);
            }
            roleUpdateLog.added++;
          } else {
            roleUpdateLog.existing++;
          }
        }
      } catch (err) {
        console.error(`Error ${isSimulation ? 'simulating' : 'updating'} WL role for user ${player.discord_id}:`, err);
      }
    }
  }

  return roleUpdateLog;
}

async function updateMoolalistRoles(
  guild: Guild,
  teamType: 'winning' | 'losing',
  threshold: number,
  isSimulation: boolean = false
) {
  console.log(`${isSimulation ? 'Simulating' : 'Starting'} moolalist role update for ${teamType} team...`);

  let roleUpdateLog = {
    added: 0,
    existing: 0
  };

  const moolalistRole = guild.roles.cache.get(MOOLALIST_ROLE_ID);
  const mlWinnerRole = guild.roles.cache.get(ML_WINNER_ROLE_ID);

  if (!moolalistRole || !mlWinnerRole) {
    console.error("Moolalist roles not found. Aborting role update.");
    return roleUpdateLog;
  }

  const teamPoints = await getTeamPoints();
  const winningTeam = teamPoints.bullas > teamPoints.beras ? "bullas" : "beras";
  const targetTeam = teamType === "winning" ? winningTeam : winningTeam === "bullas" ? "beras" : "bullas";

  const { data: players, error } = await supabase
    .from("users")
    .select("discord_id, points, team")
    .eq("team", targetTeam);

  if (error) {
    console.error("Error fetching players:", error);
    return roleUpdateLog;
  }

  for (const player of players) {
    if (player.discord_id) {
      try {
        const member = await guild.members.fetch(player.discord_id);
        if (member && player.points >= threshold) {
          if (!member.roles.cache.has(MOOLALIST_ROLE_ID) && !member.roles.cache.has(ML_WINNER_ROLE_ID)) {
            if (!isSimulation) {
              await member.roles.add(moolalistRole);
            }
            roleUpdateLog.added++;
          } else {
            roleUpdateLog.existing++;
          }
        }
      } catch (err) {
        console.error(`Error ${isSimulation ? 'simulating' : 'updating'} ML role for user ${player.discord_id}:`, err);
      }
    }
  }

  return roleUpdateLog;
}

async function updateFreeMintRoles(
  guild: Guild,
  teamType: 'winning' | 'losing',
  threshold: number,
  isSimulation: boolean = false
) {
  console.log(`${isSimulation ? 'Simulating' : 'Starting'} free mint role update for ${teamType} team...`);

  let roleUpdateLog = {
    added: 0,
    existing: 0
  };

  const freeMintRole = guild.roles.cache.get(FREE_MINT_ROLE_ID);
  const fmWinnerRole = guild.roles.cache.get(FREE_MINT_WINNER_ROLE_ID);

  if (!freeMintRole || !fmWinnerRole) {
    console.error("Free mint roles not found. Aborting role update.");
    return roleUpdateLog;
  }

  const teamPoints = await getTeamPoints();
  const winningTeam = teamPoints.bullas > teamPoints.beras ? "bullas" : "beras";
  const targetTeam = teamType === "winning" ? winningTeam : winningTeam === "bullas" ? "beras" : "bullas";

  const { data: players, error } = await supabase
    .from("users")
    .select("discord_id, points, team")
    .eq("team", targetTeam);

  if (error) {
    console.error("Error fetching players:", error);
    return roleUpdateLog;
  }

  for (const player of players) {
    if (player.discord_id) {
      try {
        const member = await guild.members.fetch(player.discord_id);
        if (member && player.points >= threshold) {
          if (!member.roles.cache.has(FREE_MINT_ROLE_ID) && !member.roles.cache.has(FREE_MINT_WINNER_ROLE_ID)) {
            if (!isSimulation) {
              await member.roles.add(freeMintRole);
            }
            roleUpdateLog.added++;
          } else {
            roleUpdateLog.existing++;
          }
        }
      } catch (err) {
        console.error(`Error ${isSimulation ? 'simulating' : 'updating'} Free Mint role for user ${player.discord_id}:`, err);
      }
    }
  }

  return roleUpdateLog;
}
/********************************************************************
 *                     CSV CREATION & SAVING
 ********************************************************************/
async function createCSV(data: any[], includeDiscordId: boolean = false, guild: Guild) {
  const header = includeDiscordId
    ? "discord_id,address,points,wl_role,ml_role,free_mint_role\n"
    : "address,points,wl_role,ml_role,free_mint_role\n";

  const memberIds = data.map((user) => user.discord_id).filter(Boolean);
  const membersMap = new Map();

  for (let i = 0; i < memberIds.length; i += 50) {
    const batch = memberIds.slice(i, i + 50);
    try {
      const members = await guild.members.fetch({ user: batch });
      members.forEach((member) => membersMap.set(member.id, member));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching batch ${i}-${i + 50}:`, error);
    }
  }

  const rows = data.map((user) => {
    const member = membersMap.get(user.discord_id);
    const hasWL =
      member?.roles.cache.has(WHITELIST_ROLE_ID) ||
      member?.roles.cache.has(WL_WINNER_ROLE_ID)
        ? "Y"
        : "N";
    const hasML =
      member?.roles.cache.has(MOOLALIST_ROLE_ID) ||
      member?.roles.cache.has(ML_WINNER_ROLE_ID)
        ? "Y"
        : "N";
    const hasFreeMint =
      member?.roles.cache.has(FREE_MINT_ROLE_ID) ||
      member?.roles.cache.has(FREE_MINT_WINNER_ROLE_ID)
        ? "Y"
        : "N";

    return includeDiscordId
      ? `${user.discord_id},${user.address},${user.points},${hasWL},${hasML},${hasFreeMint}`
      : `${user.address},${user.points},${hasWL},${hasML},${hasFreeMint}`;
  });

  return header + rows.join("\n");
}

async function saveCSV(content: string, filename: string) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const tempDir = join(__dirname, "temp");

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const filePath = join(tempDir, filename);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/********************************************************************
 *            EXCLUDE THESE USERS FROM LEADERBOARD
 ********************************************************************/
const EXCLUDED_USER_IDS = [
  "649377665496776724", // abarat
  "534027215973646346", // rxx
  "144683637718122496"  // yeshy.smol
];

/********************************************************************
 *               WHITE-LIST MINIMUM (CAN BE CHANGED)
 ********************************************************************/
let WHITELIST_MINIMUM = 100;

/********************************************************************
 *               DEFINE SLASH COMMANDS
 ********************************************************************/
/**
 * 1) /updateroles           (with simulation)
 * 2) /alreadywanked         (mass-assign NEW_WANKME_ROLE_ID)
 * 3) /purgezerobalance      (remove roles for 0 balance)
 * 4) /transfer              (admin-only transfer points)
 * 5) /updatewallet          (update user's wallet)
 * 6) /moola                 (check user moola)
 * 7) /warstatus             (check bullas vs beras total)
 * 8) /snapshot              (admin-only CSV snapshot)
 * 9) /fine                  (admin-only fine command)
 * 10) /updatewhitelistminimum (admin-only)
 * 11) /leaderboard          (paginated leaderboard)
 */
const commands = [
  // ====== 1) /updateroles ======
  new SlashCommandBuilder()
    .setName("updatewl")
    .setDescription("Update Whitelist roles")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Team to update WL roles for")
        .setRequired(true)
        .addChoices({ name: "Winning", value: "winning" }, { name: "Losing", value: "losing" })
    )
    .addIntegerOption((option) =>
      option
        .setName("threshold")
        .setDescription("MOOLA threshold for WL role")
        .setRequired(true)
    ),

  // 2. /updateml command
  new SlashCommandBuilder()
    .setName("updateml")
    .setDescription("Update Moolalist roles")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Team to update ML roles for")
        .setRequired(true)
        .addChoices({ name: "Winning", value: "winning" }, { name: "Losing", value: "losing" })
    )
    .addIntegerOption((option) =>
      option
        .setName("threshold")
        .setDescription("MOOLA threshold for ML role")
        .setRequired(true)
    ),

  // 3. /updatefreemint command
  new SlashCommandBuilder()
    .setName("updatefreemint")
    .setDescription("Update Free Mint roles")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Team to update Free Mint roles for")
        .setRequired(true)
        .addChoices({ name: "Winning", value: "winning" }, { name: "Losing", value: "losing" })
    )
    .addIntegerOption((option) =>
      option
        .setName("threshold")
        .setDescription("MOOLA threshold for Free Mint role")
        .setRequired(true)
    ),

  // ====== 2) /alreadywanked ======
  new SlashCommandBuilder()
    .setName("alreadywanked")
    .setDescription("Assign new role to all verified users (Admin only)"),

  // ====== 3) /purgezerobalance ======
  new SlashCommandBuilder()
    .setName("purgezerobalance")
    .setDescription("Remove team roles from accounts with 0 moola balance (Admin only)"),

  // ====== 4) /transfer ======
  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer points to another user (Admin only)")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to transfer points to")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("The amount of points to transfer")
        .setRequired(true)
    ),

  // ====== 5) /updatewallet ======
  new SlashCommandBuilder()
    .setName("updatewallet")
    .setDescription("Update your wallet address"),

  // ====== 6) /moola ======
  new SlashCommandBuilder()
    .setName("moola")
    .setDescription("Check your moola balance"),

  // ====== 7) /warstatus ======
  new SlashCommandBuilder()
    .setName("warstatus")
    .setDescription("Check the current war status"),

  // ====== 8) /snapshot (Admin only) ======
  new SlashCommandBuilder()
    .setName("snapshot")
    .setDescription("Take a snapshot of the current standings"),

  // ====== 9) /fine (Admin only) ======
  new SlashCommandBuilder()
    .setName("fine")
    .setDescription("Fine a user (Admin only)")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to fine")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("The amount to fine")
        .setRequired(true)
    ),

  // ====== 10) /updatewhitelistminimum (Admin only) ======
  new SlashCommandBuilder()
    .setName("updatewhitelistminimum")
    .setDescription("Update the whitelist minimum (Admin only)")
    .addIntegerOption((option) =>
      option
        .setName("minimum")
        .setDescription("The new minimum value")
        .setRequired(true)
    ),
    //wankme
    new SlashCommandBuilder()
    .setName("wankme")
    .setDescription("Get started with Moola Wars and earn your roles"),
  // ====== 11) /leaderboard ======
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the leaderboard")
    .addStringOption((option) =>
      option
        .setName("team")
        .setDescription("Team leaderboard to view")
        .setRequired(true)
        .addChoices(
          { name: "All", value: "all" },
          { name: "Bullas", value: "bullas" },
          { name: "Beras", value: "beras" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Page number")
        .setMinValue(1)
    ),
];

/********************************************************************
 *                      BOT READY EVENT
 ********************************************************************/
client.once("ready", async () => {
  console.log("Bot is ready!");
  client.user?.setPresence({
    status: "online",
    activities: [
      {
        name: "Moola war",
        type: 0, // "Playing"
      },
    ],
  });

  const rest = new REST({ version: "10" }).setToken(discordBotToken!);

  // Replace with your actual server (guild) ID
  const GUILD_ID = "1228994421966766141";

  try {
    // 1) Clear ALL global commands
    console.log("Removing ALL global commands...");
    await rest.put(Routes.applicationCommands(client.user!.id), { body: [] });
    console.log("Global commands cleared.");

    // 2) Clear GUILD commands in your single server
    console.log(`Removing ALL guild commands in server ${GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, GUILD_ID),
      { body: [] }
    );
    console.log("Guild commands cleared.");

    // 3) Re-register commands in YOUR server only
    console.log(`Registering commands in guild ${GUILD_ID}...`);
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, GUILD_ID),
      { body: commands }
    );
    console.log("Guild commands registered successfully!");

    console.log("Done! No more duplicates should remain.");
  } catch (error) {
    console.error("Error clearing or registering commands:", error);
  }
});


/********************************************************************
 *                MAIN INTERACTION HANDLER
 ********************************************************************/
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  // -------------------------------------------------------
  // 1) /updatewl
  // -------------------------------------------------------
  if (interaction.commandName === "updatewl") {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply("Failed to simulate: Guild not found.");
    }

    const team = interaction.options.getString("team", true) as "winning" | "losing";
    const threshold = interaction.options.getInteger("threshold", true);

    try {
      // Simulation
      const simulationLog = await updateWhitelistRoles(
        guild,
        team,
        threshold,
        true // isSimulation
      );

      const simResultMsg = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Whitelist Role Update Simulation")
        .setDescription(
          `**Here's what will happen if you proceed:**\n\n` +
            `**Whitelist Role:**\n` +
            `• ${simulationLog.added} users will receive the role\n` +
            `• ${simulationLog.existing} users already have it\n\n` +
            `Would you like to proceed with these changes?`
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_wl_${team}_${threshold}`)
          .setLabel("Proceed with Update")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cancel_wl_update")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [simResultMsg],
        components: [row],
      });
    } catch (error) {
      console.error("Error in WL update simulation:", error);
      await interaction.editReply("An error occurred while simulating WL role updates.");
    }
  }

  // -------------------------------------------------------
  // 2) /updateml
  // -------------------------------------------------------
  if (interaction.commandName === "updateml") {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply("Failed to simulate: Guild not found.");
    }

    const team = interaction.options.getString("team", true) as "winning" | "losing";
    const threshold = interaction.options.getInteger("threshold", true);

    try {
      // Simulation
      const simulationLog = await updateMoolalistRoles(
        guild,
        team,
        threshold,
        true // isSimulation
      );

      const simResultMsg = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Moolalist Role Update Simulation")
        .setDescription(
          `**Here's what will happen if you proceed:**\n\n` +
            `**Moolalist Role:**\n` +
            `• ${simulationLog.added} users will receive the role\n` +
            `• ${simulationLog.existing} users already have it\n\n` +
            `Would you like to proceed with these changes?`
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_ml_${team}_${threshold}`)
          .setLabel("Proceed with Update")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cancel_ml_update")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [simResultMsg],
        components: [row],
      });
    } catch (error) {
      console.error("Error in ML update simulation:", error);
      await interaction.editReply("An error occurred while simulating ML role updates.");
    }
  }

  // -------------------------------------------------------
  // 3) /updatefreemint
  // -------------------------------------------------------
  if (interaction.commandName === "updatefreemint") {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) {
      return interaction.editReply("Failed to simulate: Guild not found.");
    }

    const team = interaction.options.getString("team", true) as "winning" | "losing";
    const threshold = interaction.options.getInteger("threshold", true);

    try {
      // Simulation
      const simulationLog = await updateFreeMintRoles(
        guild,
        team,
        threshold,
        true // isSimulation
      );

      const simResultMsg = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Free Mint Role Update Simulation")
        .setDescription(
          `**Here's what will happen if you proceed:**\n\n` +
            `**Free Mint Role:**\n` +
            `• ${simulationLog.added} users will receive the role\n` +
            `• ${simulationLog.existing} users already have it\n\n` +
            `Would you like to proceed with these changes?`
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_fm_${team}_${threshold}`)
          .setLabel("Proceed with Update")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("cancel_fm_update")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [simResultMsg],
        components: [row],
      });
    } catch (error) {
      console.error("Error in Free Mint update simulation:", error);
      await interaction.editReply("An error occurred while simulating Free Mint role updates.");
    }
  }

  // -------------------------------------------------------
  // /alreadywanked (admin)
  // -------------------------------------------------------
  if (interaction.commandName === "alreadywanked") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const { data: verifiedUsers, error } = await supabase
        .from("users")
        .select("discord_id")
        .not("address", "is", null);

      if (error) throw error;

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("Failed to find guild.");
        return;
      }

      const newRole = guild.roles.cache.get(NEW_WANKME_ROLE_ID);
      if (!newRole) {
        await interaction.editReply("Failed to find the new role.");
        return;
      }

      let addedCount = 0;
      let existingCount = 0;
      let errorCount = 0;

      for (const user of verifiedUsers) {
        try {
          const member = await guild.members.fetch(user.discord_id);
          if (member) {
            if (!member.roles.cache.has(NEW_WANKME_ROLE_ID)) {
              await member.roles.add(newRole);
              addedCount++;
            } else {
              existingCount++;
            }
          }
        } catch (err) {
          console.error(`Error processing user ${user.discord_id}:`, err);
          errorCount++;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const resultEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Already Wanked Role Assignment Complete")
        .setDescription(
          `**Results:**\n\n` +
            `• ${addedCount} users received the new role\n` +
            `• ${existingCount} users already had the role\n` +
            `• ${errorCount} errors encountered\n\n` +
            `Total verified users processed: ${verifiedUsers.length}`
        );

      await interaction.editReply({ embeds: [resultEmbed] });
    } catch (err) {
      console.error("Error in alreadywanked command:", err);
      await interaction.editReply("An error occurred while assigning roles to verified users.");
    }
  }
  //wankme
  if (interaction.commandName === "wankme") {
    const userId = interaction.user.id;
    const uuid = v4();

    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

      if (userData) {
        await interaction.reply({
          content: `You have already linked your account. Your linked account: \`${maskAddress(userData.address)}\``,
          ephemeral: true
        });
        return;
      }

    const { data, error } = await supabase
      .from("tokens")
      .insert({ token: uuid, discord_id: userId, used: false })
      .single();

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("Some title")
      .setDescription("Some description");

    if (error) {
      console.error("Error inserting token:", error);
      await interaction.reply({
        content: "An error occurred while generating the token.",
        ephemeral: true,
      });
    } else {
      const vercelUrl = `${process.env.VERCEL_URL}/game?token=${uuid}&discord=${userId}`;
      await interaction.reply({
        content: `Hey ${interaction.user.username}, to link your Discord account to your address click this link: \n\n${vercelUrl} `,
        ephemeral: true,
      });
    }
  }
  // -------------------------------------------------------
  // /purgezerobalance (admin)
  // -------------------------------------------------------
  if (interaction.commandName === "purgezerobalance") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    try {
      const { data: zeroBalanceUsers, error } = await supabase
        .from("users")
        .select("discord_id, team")
        .eq("points", 0)
        .or("team.eq.bullas,team.eq.beras");

      if (error) throw error;

      let removedCount = 0;
      for (const user of zeroBalanceUsers) {
        try {
          const member = await interaction.guild?.members.fetch(user.discord_id);
          if (member) {
            if (user.team === "bullas" && member.roles.cache.has(BULL_ROLE_ID)) {
              await member.roles.remove(BULL_ROLE_ID);
              removedCount++;
            } else if (user.team === "beras" && member.roles.cache.has(BEAR_ROLE_ID)) {
              await member.roles.remove(BEAR_ROLE_ID);
              removedCount++;
            }
          }
        } catch (roleRemoveErr) {
          console.error(`Error removing role from user ${user.discord_id}:`, roleRemoveErr);
        }
      }

      await interaction.editReply(
        `Removed team roles from ${removedCount} accounts with 0 moola balance.`
      );
    } catch (err) {
      console.error("Error executing purgezerobalance command:", err);
      await interaction.editReply("An error occurred while purging zero balance accounts.");
    }
  }

  // -------------------------------------------------------
  // /transfer (admin only)
  // -------------------------------------------------------
  if (interaction.commandName === "transfer") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const userId = interaction.user.id;
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.get("amount")?.value as number;

    if (!targetUser || !amount) {
      await interaction.reply("Please provide a valid user and amount.");
      return;
    }

    const { data: senderData, error: senderError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (senderError || !senderData) {
      console.error("Error fetching sender:", senderError);
      await interaction.reply("An error occurred while fetching the sender.");
      return;
    }

    if (senderData.points < amount) {
      await interaction.reply("Insufficient points to transfer.");
      return;
    }

    const { data: receiverData, error: receiverError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", targetUser.id)
      .single();

    if (receiverError) {
      console.error("Error fetching receiver:", receiverError);
      await interaction.reply("An error occurred while fetching the receiver.");
      return;
    }

    if (!receiverData) {
      await interaction.reply("The specified user does not exist.");
      return;
    }

    const senderPoints = new Decimal(senderData.points);
    const receiverPoints = new Decimal(receiverData.points);
    const transferAmount = new Decimal(amount);

    const updatedSenderPoints = senderPoints.minus(transferAmount);
    const updatedReceiverPoints = receiverPoints.plus(transferAmount);

    const { error: senderUpdateError } = await supabase
      .from("users")
      .update({ points: updatedSenderPoints.toNumber() })
      .eq("discord_id", userId);

    if (senderUpdateError) {
      console.error("Error updating sender points:", senderUpdateError);
      await interaction.reply("An error occurred while updating sender points.");
      return;
    }

    const { error: receiverUpdateError } = await supabase
      .from("users")
      .update({ points: updatedReceiverPoints.toNumber() })
      .eq("discord_id", targetUser.id);

    if (receiverUpdateError) {
      console.error("Error updating receiver points:", receiverUpdateError);
      await interaction.reply("An error occurred while updating receiver points.");
      return;
    }

    await interaction.reply(
      `Successfully transferred ${amount} points to <@${targetUser.id}>.`
    );
  }

  // -------------------------------------------------------
  // /updatewallet
  // -------------------------------------------------------
  if (interaction.commandName === "updatewallet") {
    const userId = interaction.user.id;
    const uuid = v4();

    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (!userData) {
      await interaction.reply({
        content: "You need to link your account first. Use /wankme to get started.",
        ephemeral: true,
      });
      return;
    }

    const { error } = await supabase
      .from("tokens")
      .insert({ token: uuid, discord_id: userId, used: false })
      .single();

    if (error) {
      console.error("Error inserting token:", error);
      await interaction.reply({
        content: "An error occurred while generating the token.",
        ephemeral: true,
      });
    } else {
      const vercelUrl = `${process.env.VERCEL_URL}/update-wallet?token=${uuid}&discord=${userId}`;
      await interaction.reply({
        content: `Hey ${interaction.user.username}, to update your wallet address, click this link:\n\n${vercelUrl}`,
        ephemeral: true,
      });
    }
  }

  // -------------------------------------------------------
  // /moola
  // -------------------------------------------------------
  if (interaction.commandName === "moola") {
    const userId = interaction.user.id;

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (error) {
      console.error("Error fetching user:", error);
      await interaction.reply("An error occurred while fetching the user.");
    } else if (!data) {
      await interaction.reply("No account found for your Discord user. Try /wankme first.");
    } else {
      const moolaEmbed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${interaction.user.username}'s moola`)
        .setDescription(`You have ${data.points} moola. 🍯`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();

      await interaction.reply({
        embeds: [moolaEmbed],
      });
    }
  }

  // -------------------------------------------------------
  // /warstatus
  // -------------------------------------------------------
  if (interaction.commandName === "warstatus") {
    try {
      const [bullasData, berasData] = await Promise.all([
        supabase.rpc("sum_points_for_team", { team_name: "bullas" }),
        supabase.rpc("sum_points_for_team", { team_name: "beras" }),
      ]);

      const bullas = bullasData.data ?? 0;
      const beras = berasData.data ?? 0;

      const embed = new EmbedBuilder()
        .setTitle("🏆 Moola War Status")
        .setDescription(`The battle between the Bullas and Beras rages on!`)
        .addFields(
          {
            name: "🐂 Bullas",
            value: `moola (mL): ${bullas}`,
            inline: true,
          },
          {
            name: "🐻 Beras",
            value: `moola (mL): ${beras}`,
            inline: true,
          }
        )
        .setColor("#FF0000");

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching war status:", error);
      await interaction.reply("An error occurred while fetching the war status.");
    }
  }

  // -------------------------------------------------------
  // /snapshot (admin only)
  // -------------------------------------------------------
  if (interaction.commandName === "snapshot") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    // Defer to avoid 3-second timeout
    await interaction.deferReply({ ephemeral: true });

    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("Guild not found.");
        return;
      }

      const teamPoints = await getTeamPoints();
      const winningTeam = teamPoints.bullas > teamPoints.beras ? "bullas" : "beras";
      const losingTeam = winningTeam === "bullas" ? "beras" : "bullas";

      const winningTopPlayers = await getTopPlayers(winningTeam, 2000);
      const losingTopPlayers = await getTopPlayers(losingTeam, 700);
      const allPlayers = await getTopPlayers(winningTeam, Number.MAX_SAFE_INTEGER);
      allPlayers.push(...(await getTopPlayers(losingTeam, Number.MAX_SAFE_INTEGER)));
      allPlayers.sort((a, b) => b.points - a.points);

      const winningCSV = await createCSV(winningTopPlayers, false, guild);
      const losingCSV = await createCSV(losingTopPlayers, false, guild);
      const allCSV = await createCSV(allPlayers, true, guild);

      const winningFile = await saveCSV(winningCSV, `top_2000_${winningTeam}.csv`);
      const losingFile = await saveCSV(losingCSV, `top_700_${losingTeam}.csv`);
      const allFile = await saveCSV(allCSV, `all_players.csv`);

      await interaction.editReply({
        content: `Here are the snapshot files with role information:`,
        files: [winningFile, losingFile, allFile],
      });

      fs.unlinkSync(winningFile);
      fs.unlinkSync(losingFile);
      fs.unlinkSync(allFile);
    } catch (error) {
      console.error("Error handling snapshot command:", error);
      await interaction.editReply("An error occurred while processing the snapshot command.");
    }
  }

  // -------------------------------------------------------
  // /fine (admin only)
  // -------------------------------------------------------
  if (interaction.commandName === "fine") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.get("amount")?.value as number;

    if (!targetUser || !amount || amount <= 0) {
      await interaction.reply("Please provide a valid user and a positive amount.");
      return;
    }

    try {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("discord_id", targetUser.id)
        .single();

      if (userError || !userData) {
        await interaction.reply("User not found or an error occurred.");
        return;
      }

      const currentPoints = new Decimal(userData.points);
      const fineAmount = new Decimal(amount);

      if (currentPoints.lessThan(fineAmount)) {
        await interaction.reply("The user doesn't have enough points for this fine.");
        return;
      }

      const updatedPoints = currentPoints.minus(fineAmount);

      const { error: updateError } = await supabase
        .from("users")
        .update({ points: updatedPoints.toNumber() })
        .eq("discord_id", targetUser.id);

      if (updateError) {
        throw new Error("Failed to update user points");
      }

      await interaction.reply(
        `Successfully fined <@${targetUser.id}> ${amount} points. Their new balance is ${updatedPoints} points.`
      );
    } catch (error) {
      console.error("Error handling fine command:", error);
      await interaction.reply("An error occurred while processing the fine command.");
    }
  }

  // -------------------------------------------------------
  // /updatewhitelistminimum (admin only)
  // -------------------------------------------------------
  if (interaction.commandName === "updatewhitelistminimum") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    const newMinimum = interaction.options.get("minimum")?.value as number;
    if (!newMinimum || newMinimum <= 0) {
      await interaction.reply("Please provide a valid positive integer for the new minimum.");
      return;
    }

    WHITELIST_MINIMUM = newMinimum;
    await interaction.reply(`Whitelist minimum updated to ${WHITELIST_MINIMUM} MOOLA.`);
  }

  // -------------------------------------------------------
  // /leaderboard
  // -------------------------------------------------------
  if (interaction.commandName === "leaderboard") {
    try {
      const teamOption = interaction.options.getString("team", true);
      const page = interaction.options.getInteger("page") || 1;
      const itemsPerPage = 10;
      const skip = (page - 1) * itemsPerPage;

      // Get user's rank first
      let rankQuery = supabase
        .from("users")
        .select("discord_id, points, team")
        .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
        .order("points", { ascending: false });

      if (teamOption !== "all") {
        rankQuery = rankQuery.eq("team", teamOption);
      }

      const { data: allUsers } = await rankQuery;
      const userRank = allUsers?.findIndex((user) => user.discord_id === interaction.user.id) ?? -1;
      const userData = allUsers?.[userRank];

      // Get paginated leaderboard data
      let query = supabase
        .from("users")
        .select("discord_id, points, team", { count: "exact" })
        .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
        .order("points", { ascending: false });

      if (teamOption !== "all") {
        query = query.eq("team", teamOption);
      }

      const { data: leaderboardData, count, error } = await query.range(
        skip,
        skip + itemsPerPage - 1
      );
      if (error) {
        throw error;
      }

      if (!leaderboardData || leaderboardData.length === 0) {
        await interaction.reply("No users found.");
        return;
      }

      const totalPages = Math.ceil((count || 0) / itemsPerPage);

      const leaderboardEmbed = new EmbedBuilder()
        .setColor(
          teamOption === "bullas"
            ? "#22C55E"
            : teamOption === "beras"
            ? "#EF4444"
            : "#FFD700"
        );

      // Add user's rank at the top
      if (userRank !== -1 && userData) {
        leaderboardEmbed.addFields({
          name: "Your Rank",
          value: `${userRank + 1}. ${
            userData.team === "bullas" ? "🐂" : "🐻"
          } ${interaction.user.username} • ${userData.points.toLocaleString()} mL`,
          inline: false,
        });
      }

      // Leaderboard entries
      const leaderboardEntries = await Promise.all(
        leaderboardData.map(async (entry, index) => {
          const user = await client.users.fetch(entry.discord_id);
          const position = skip + index + 1;
          return `${position}. ${
            entry.team === "bullas" ? "🐂" : "🐻"
          } ${user.username} • ${entry.points.toLocaleString()} mL`;
        })
      );

      leaderboardEmbed.addFields({
        name: "🏆 Leaderboard",
        value: leaderboardEntries.join("\n"),
        inline: false,
      });

      leaderboardEmbed.setFooter({ text: `Page ${page}/${totalPages}` });

      // Pagination buttons
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`prev_${teamOption}_${page}`)
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 1),
        new ButtonBuilder()
          .setCustomId(`next_${teamOption}_${page}`)
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages)
      );

      await interaction.reply({
        embeds: [leaderboardEmbed],
        components: [row],
      });
    } catch (error) {
      console.error("Error handling leaderboard command:", error);
      await interaction.reply("An error occurred while processing the leaderboard command.");
    }
  }
});

/********************************************************************
 *      BUTTON HANDLER (CONFIRM or CANCEL ROLE UPDATES)
 ********************************************************************/
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  // CANCEL BUTTONS
  // e.g., "cancel_wl_update", "cancel_ml_update", "cancel_fm_update"
  if (
    interaction.customId === "cancel_wl_update" ||
    interaction.customId === "cancel_ml_update" ||
    interaction.customId === "cancel_fm_update"
  ) {
    await interaction.update({
      content: "Role update cancelled.",
      embeds: [],
      components: [],
    });
    return;
  }

  // CONFIRM WL
  if (interaction.customId.startsWith("confirm_wl_")) {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to confirm this action.",
        ephemeral: true,
      });
    }

    const [, , team, threshold] = interaction.customId.split("_");
    await interaction.update({
      content: "Executing whitelist role updates...",
      embeds: [],
      components: [],
    });

    try {
      const roleUpdateLog = await updateWhitelistRoles(
        interaction.guild!,
        team as "winning" | "losing",
        parseInt(threshold),
        false
      );

      await interaction.editReply(
        `Whitelist role updates completed!\n\n` +
          `**Results:**\n` +
          `• ${roleUpdateLog.added} roles added\n` +
          `• ${roleUpdateLog.existing} users already had the role\n`
      );
    } catch (error) {
      console.error("Error executing WL role updates:", error);
      await interaction.editReply("An error occurred while updating whitelist roles.");
    }
  }

  // CONFIRM ML
  if (interaction.customId.startsWith("confirm_ml_")) {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to confirm this action.",
        ephemeral: true,
      });
    }

    const [, , team, threshold] = interaction.customId.split("_");
    await interaction.update({
      content: "Executing moolalist role updates...",
      embeds: [],
      components: [],
    });

    try {
      const roleUpdateLog = await updateMoolalistRoles(
        interaction.guild!,
        team as "winning" | "losing",
        parseInt(threshold),
        false
      );

      await interaction.editReply(
        `Moolalist role updates completed!\n\n` +
          `**Results:**\n` +
          `• ${roleUpdateLog.added} roles added\n` +
          `• ${roleUpdateLog.existing} users already had the role\n`
      );
    } catch (error) {
      console.error("Error executing ML role updates:", error);
      await interaction.editReply("An error occurred while updating moolalist roles.");
    }
  }

  // CONFIRM FREE MINT
  if (interaction.customId.startsWith("confirm_fm_")) {
    if (!hasAdminRole(interaction.member)) {
      return interaction.reply({
        content: "You don't have permission to confirm this action.",
        ephemeral: true,
      });
    }

    const [, , team, threshold] = interaction.customId.split("_");
    await interaction.update({
      content: "Executing free mint role updates...",
      embeds: [],
      components: [],
    });

    try {
      const roleUpdateLog = await updateFreeMintRoles(
        interaction.guild!,
        team as "winning" | "losing",
        parseInt(threshold),
        false
      );

      await interaction.editReply(
        `Free Mint role updates completed!\n\n` +
          `**Results:**\n` +
          `• ${roleUpdateLog.added} roles added\n` +
          `• ${roleUpdateLog.existing} users already had the role\n`
      );
    } catch (error) {
      console.error("Error executing Free Mint role updates:", error);
      await interaction.editReply("An error occurred while updating free mint roles.");
    }
  }

  // Leaderboard pagination
  const [action, teamOption, currentPage] = interaction.customId.split("_");
  if (action !== "prev" && action !== "next") return;

  // Only allow the user who ran the command to use these buttons
  if (interaction.message.interaction?.user.id !== interaction.user.id) {
    await interaction.reply({
      content: "Only the user who ran this command can use these buttons.",
      ephemeral: true,
    });
    return;
  }

  const newPage = action === "next" ? parseInt(currentPage) + 1 : parseInt(currentPage) - 1;
  await interaction.deferUpdate();

  try {
    const itemsPerPage = 10;
    const skip = (newPage - 1) * itemsPerPage;

    // Get user's rank first
    let rankQuery = supabase
      .from("users")
      .select("discord_id, points, team")
      .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
      .order("points", { ascending: false });

    if (teamOption !== "all") {
      rankQuery = rankQuery.eq("team", teamOption);
    }

    const { data: allUsers } = await rankQuery;
    const userRank = allUsers?.findIndex((user) => user.discord_id === interaction.user.id) ?? -1;
    const userData = allUsers?.[userRank];

    // Get paginated data
    let query = supabase
      .from("users")
      .select("discord_id, points, team", { count: "exact" })
      .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
      .order("points", { ascending: false });

    if (teamOption !== "all") {
      query = query.eq("team", teamOption);
    }

    const { data: leaderboardData, count, error } = await query.range(skip, skip + itemsPerPage - 1);
    if (error) throw error;

    const totalPages = Math.ceil((count || 0) / itemsPerPage);

    const leaderboardEmbed = new EmbedBuilder()
      .setColor(teamOption === "bullas" ? "#22C55E" : teamOption === "beras" ? "#EF4444" : "#FFD700");

    if (userRank !== -1 && userData) {
      leaderboardEmbed.addFields({
        name: "Your Rank",
        value: `${userRank + 1}. ${
          userData.team === "bullas" ? "🐂" : "🐻"
        } ${interaction.user.username} • ${userData.points.toLocaleString()} mL`,
        inline: false,
      });
    }

    const leaderboardEntries = await Promise.all(
      leaderboardData.map(async (entry, index) => {
        const user = await client.users.fetch(entry.discord_id);
        const position = skip + index + 1;
        return `${position}. ${
          entry.team === "bullas" ? "🐂" : "🐻"
        } ${user.username} • ${entry.points.toLocaleString()} mL`;
      })
    );

    leaderboardEmbed.addFields({
      name: "🏆 Leaderboard",
      value: leaderboardEntries.join("\n"),
      inline: false,
    });

    leaderboardEmbed.setFooter({ text: `Page ${newPage}/${totalPages}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`prev_${teamOption}_${newPage}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage <= 1),
      new ButtonBuilder()
        .setCustomId(`next_${teamOption}_${newPage}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(newPage >= totalPages)
    );

    await interaction.editReply({
      embeds: [leaderboardEmbed],
      components: [row],
    });
  } catch (error) {
    console.error("Error handling leaderboard pagination:", error);
    await interaction.editReply({
      content: "An error occurred while updating the leaderboard.",
      components: [],
    });
  }
});

/********************************************************************
 *                GUILD MEMBER ADD EVENT
 ********************************************************************/
client.on("guildMemberAdd", async (member) => {
  const mootardRole = member.guild.roles.cache.get(MOOTARD_ROLE_ID);
  if (mootardRole) {
    await member.roles.add(mootardRole);
    console.log(`Added Mootard role to new member: ${member.user.tag}`);
  }
});

/********************************************************************
 *                 HEARTBEAT CHECK (OPTIONAL)
 ********************************************************************/
setInterval(() => {
  if (!client.ws.ping) {
    console.log("Connection lost, attempting to reconnect...");
    client.login(discordBotToken);
  }
}, 30000);

/********************************************************************
 *                   DISCORD LOGIN
 ********************************************************************/
client.login(discordBotToken);

/********************************************************************
 *                    EXPRESS SERVER (OPTIONAL)
 ********************************************************************/
const app = express();
app.use(express.json());
app.use(cors());

const server = http.createServer(app);
const PORT = process.env.PORT || 3003;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
