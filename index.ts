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
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { v4 } from "uuid";
import { Database } from "./types/supabase";
import _ from 'lodash';

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
        name: 'BULLAS WIN THE MW',
        type: 3, // "Watching"
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
const WHITELIST_ROLE_ID = "1263470313300295751";
const MOOLALIST_ROLE_ID = "1263470568536014870";
const FREE_MINT_ROLE_ID = "1328473525710884864"; // Free Mint Role
const FREE_MINT_WINNER_ROLE_ID = "1263470790314164325"; // Free Mint Winner Role
const MOOTARD_ROLE_ID = "1281979123534925967";
const NEW_WANKME_ROLE_ID = "1328471474947883120";
const WL_WINNER_ROLE_ID = "1264963781419597916";
const ML_WINNER_ROLE_ID = "1267532607491407933";
const BULL_ROLE_ID = "1230207362145452103";
const BEAR_ROLE_ID = "1230207106896892006";

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
 *                     CSV CREATION & SAVING
 ********************************************************************/
async function createCSV(data: any[], includeDiscordId: boolean = false, guild: Guild) {
  const header = includeDiscordId
    ? "discord_id,address,points,wl_role,wl_winner_role,ml_role,ml_winner_role,free_mint_role,free_mint_winner_role\n"
    : "address,points,wl_role,wl_winner_role,ml_role,ml_winner_role,free_mint_role,free_mint_winner_role\n";

  // ---------------------------------------------------
  // 1) First, deduplicate the input data
  // ---------------------------------------------------
  const uniqueData = Array.from(new Map(data.map(item => [item.discord_id, item])).values());
  console.log(`Original entries: ${data.length}, After deduplication: ${uniqueData.length}`);

  // ---------------------------------------------------
  // 2) Fetch Discord members and create stats
  // ---------------------------------------------------
  console.log("Fetching Discord members...");
  const allMembers = await guild.members.fetch();
  
  const discordStats = {
    totalWL: 0,
    totalWLWinner: 0,
    totalML: 0,
    totalMLWinner: 0,
    totalFreeMint: 0,
    totalFreeMintWinner: 0,
    usersWithRoleNoWallet: {
      wl: 0,
      wlWinner: 0,
      ml: 0,
      mlWinner: 0,
      freeMint: 0,
      freeMintWinner: 0
    }
  };

  // ---------------------------------------------------
  // 3) Process verified users (those with wallets)
  // ---------------------------------------------------
  const processedDiscordIds = new Set();
  const rows: string[] = [];

  for (const user of uniqueData) {
    if (!user.discord_id || !user.address) continue;

    const member = await guild.members.fetch(user.discord_id).catch(() => null);
    if (!member) continue;

    processedDiscordIds.add(user.discord_id);

    // Check roles
    const hasWLRole = member.roles.cache.has(WHITELIST_ROLE_ID) ? "Y" : "N";
    const hasWLWinnerRole = member.roles.cache.has(WL_WINNER_ROLE_ID) ? "Y" : "N";
    const hasMLRole = member.roles.cache.has(MOOLALIST_ROLE_ID) ? "Y" : "N";
    const hasMLWinnerRole = member.roles.cache.has(ML_WINNER_ROLE_ID) ? "Y" : "N";
    const hasFreeMintRole = member.roles.cache.has(FREE_MINT_ROLE_ID) ? "Y" : "N";
    const hasFreeMintWinnerRole = member.roles.cache.has(FREE_MINT_WINNER_ROLE_ID) ? "Y" : "N";

    // Skip users who don't have any roles
    if (hasWLRole === "N" && hasWLWinnerRole === "N" && 
        hasMLRole === "N" && hasMLWinnerRole === "N" && 
        hasFreeMintRole === "N" && hasFreeMintWinnerRole === "N") {
      continue;
    }

    // Update statistics
    if (hasWLRole === "Y") discordStats.totalWL++;
    if (hasWLWinnerRole === "Y") discordStats.totalWLWinner++;
    if (hasMLRole === "Y") discordStats.totalML++;
    if (hasMLWinnerRole === "Y") discordStats.totalMLWinner++;
    if (hasFreeMintRole === "Y") discordStats.totalFreeMint++;
    if (hasFreeMintWinnerRole === "Y") discordStats.totalFreeMintWinner++;

    // Format the row
    const rowData = includeDiscordId
      ? `${user.discord_id},${user.address},${user.points || 0},${hasWLRole},${hasWLWinnerRole},${hasMLRole},${hasMLWinnerRole},${hasFreeMintRole},${hasFreeMintWinnerRole}`
      : `${user.address},${user.points || 0},${hasWLRole},${hasWLWinnerRole},${hasMLRole},${hasMLWinnerRole},${hasFreeMintRole},${hasFreeMintWinnerRole}`;

    rows.push(rowData);
  }

  // ---------------------------------------------------
  // 4) Find users with roles but no wallet
  // ---------------------------------------------------
  const unverifiedUsers = {
    wl: [] as string[],
    wlWinner: [] as string[],
    ml: [] as string[],
    mlWinner: [] as string[],
    freeMint: [] as string[],
    freeMintWinner: [] as string[]
  };

  allMembers.forEach(member => {
    // Skip users we've already processed
    if (processedDiscordIds.has(member.id)) return;

    // Check each role
    if (member.roles.cache.has(WHITELIST_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.wl++;
      unverifiedUsers.wl.push(`${member.user.tag} (${member.id})`);
    }
    if (member.roles.cache.has(WL_WINNER_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.wlWinner++;
      unverifiedUsers.wlWinner.push(`${member.user.tag} (${member.id})`);
    }
    if (member.roles.cache.has(MOOLALIST_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.ml++;
      unverifiedUsers.ml.push(`${member.user.tag} (${member.id})`);
    }
    if (member.roles.cache.has(ML_WINNER_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.mlWinner++;
      unverifiedUsers.mlWinner.push(`${member.user.tag} (${member.id})`);
    }
    if (member.roles.cache.has(FREE_MINT_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.freeMint++;
      unverifiedUsers.freeMint.push(`${member.user.tag} (${member.id})`);
    }
    if (member.roles.cache.has(FREE_MINT_WINNER_ROLE_ID)) {
      discordStats.usersWithRoleNoWallet.freeMintWinner++;
      unverifiedUsers.freeMintWinner.push(`${member.user.tag} (${member.id})`);
    }
  });

  // ---------------------------------------------------
  // 5) Log Statistics
  // ---------------------------------------------------
  console.log("\n=== Discord Role Statistics ===");
  console.log(`WL Roles in Discord: ${discordStats.totalWL}`);
  console.log(`WL Winner Roles in Discord: ${discordStats.totalWLWinner}`);
  console.log(`ML Roles in Discord: ${discordStats.totalML}`);
  console.log(`ML Winner Roles in Discord: ${discordStats.totalMLWinner}`);
  console.log(`Free Mint Roles in Discord: ${discordStats.totalFreeMint}`);
  console.log(`Free Mint Winner Roles in Discord: ${discordStats.totalFreeMintWinner}`);

  console.log("\n=== Users with Roles but No Wallet ===");
  console.log(`WL Role, No Wallet (${unverifiedUsers.wl.length}):`, unverifiedUsers.wl);
  console.log(`\nWL Winner Role, No Wallet (${unverifiedUsers.wlWinner.length}):`, unverifiedUsers.wlWinner);
  console.log(`\nML Role, No Wallet (${unverifiedUsers.ml.length}):`, unverifiedUsers.ml);
  console.log(`\nML Winner Role, No Wallet (${unverifiedUsers.mlWinner.length}):`, unverifiedUsers.mlWinner);
  console.log(`\nFree Mint Role, No Wallet (${unverifiedUsers.freeMint.length}):`, unverifiedUsers.freeMint);
  console.log(`\nFree Mint Winner Role, No Wallet (${unverifiedUsers.freeMintWinner.length}):`, unverifiedUsers.freeMintWinner);

  // Return final CSV
  return header + rows.join("\n");
}

async function saveCSV(content: string, filename: string) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const tempDir = join(__dirname, "temp");

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  // Create file path and save the file
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
 *               DEFINE SLASH COMMANDS
 ********************************************************************/
/**
 * 1) /updateroles           (with simulation)
 * 2) /alreadywanked         (mass-assign NEW_WANKME_ROLE_ID)
 * 8) /snapshot              (admin-only CSV snapshot)
 * 11) /leaderboard          (paginated leaderboard)
 */

const commands = [
  // ====== 2) /alreadywanked ======
  new SlashCommandBuilder()
    .setName("alreadywanked")
    .setDescription("Assign new role to all verified users (Admin only)"),

  // ====== 5) /updatewallet ======
  new SlashCommandBuilder()
    .setName("updatewallet")
    .setDescription("Update your wallet address"),

  // ====== 8) /snapshot (Admin only) ======
  new SlashCommandBuilder()
    .setName("snapshot")
    .setDescription("Take a snapshot of the current standings"),

  // ====== /wankme ======
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
          { name: "Bullas", value: "bullas" },
          { name: "Beras", value: "beras" }
        )
    )
    .addIntegerOption((option) =>
      option
        .setName("page")
        .setDescription("Page number")
        .setMinValue(1)
    )
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

    // Create a new channel message instead of using interaction reply
    let statusMessage = await interaction.channel.send("Starting role assignment process...");
    await interaction.reply({ content: "Process started! Check status message above.", ephemeral: true });

    try {
      let processedTotal = 0;
      let totalAdded = 0;
      let totalExisting = 0;
      let totalErrors = 0;
      let hasMore = true;
      const chunkSize = 1000;

      const guild = interaction.guild;
      if (!guild) {
        await statusMessage.edit("Failed to find guild.");
        return;
      }

      const newRole = guild.roles.cache.get(NEW_WANKME_ROLE_ID);
      if (!newRole) {
        await statusMessage.edit("Failed to find the new role.");
        return;
      }

      while (hasMore) {
        const { data: verifiedUsers, error } = await supabase
          .from("users")
          .select("discord_id")
          .not("address", "is", null)
          .range(processedTotal, processedTotal + chunkSize - 1)
          .order('discord_id', { ascending: true });

        if (error) throw error;
        if (!verifiedUsers || verifiedUsers.length === 0) {
          hasMore = false;
          continue;
        }

        const batchSize = 100;
        for (let i = 0; i < verifiedUsers.length; i += batchSize) {
          const batch = verifiedUsers.slice(i, i + batchSize);

          for (const user of batch) {
            if (!user?.discord_id) {
              totalErrors++;
              continue;
            }

            try {
              const member = await guild.members.fetch(user.discord_id).catch(() => null);

              if (member) {
                if (!member.roles.cache.has(NEW_WANKME_ROLE_ID)) {
                  await member.roles.add(newRole);
                  totalAdded++;
                } else {
                  totalExisting++;
                }
              } else {
                totalErrors++;
              }
            } catch (err) {
              console.error(`Error processing user ${user.discord_id}:`, err);
              totalErrors++;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          processedTotal += batch.length;

          // Update status message every 100 users
          try {
            await statusMessage.edit({
              content: "",
              embeds: [
                new EmbedBuilder()
                  .setColor(0x0099ff)
                  .setTitle("Already Wanked Role Assignment Progress")
                  .setDescription(
                    `**Progress:**\n\n` +
                    `• ${totalAdded} users received the new role\n` +
                    `• ${totalExisting} users already had the role\n` +
                    `• ${totalErrors} errors encountered\n\n` +
                    `Processed ${processedTotal} users so far`
                  )
              ]
            });
          } catch (err) {
            // If status message edit fails, create a new one
            try {
              const newStatusMessage = await interaction.channel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0x0099ff)
                    .setTitle("Already Wanked Role Assignment Progress (Continued)")
                    .setDescription(
                      `**Progress:**\n\n` +
                      `• ${totalAdded} users received the new role\n` +
                      `• ${totalExisting} users already had the role\n` +
                      `• ${totalErrors} errors encountered\n\n` +
                      `Processed ${processedTotal} users so far`
                    )
                ]
              });
              statusMessage = newStatusMessage;
            } catch (msgError) {
              console.error("Failed to send new status message:", msgError);
            }
          }
        }
      }

      // Final update
      try {
        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x0099ff)
              .setTitle("Already Wanked Role Assignment Complete")
              .setDescription(
                `**Final Results:**\n\n` +
                `• ${totalAdded} users received the new role\n` +
                `• ${totalExisting} users already had the role\n` +
                `• ${totalErrors} errors encountered\n\n` +
                `Total users processed: ${processedTotal}`
              )
          ]
        });
      } catch (err) {
        console.error("Error sending final message:", err);
      }

    } catch (err) {
      console.error("Error in alreadywanked command:", err);
      try {
        await interaction.channel.send("An error occurred while assigning roles to verified users.");
      } catch (msgErr) {
        console.error("Failed to send error message:", msgErr);
      }
    }
  }

  // -------------------------------------------------------
  // /wankme
  // -------------------------------------------------------
  if (interaction.commandName === "wankme") {
    const userId = interaction.user.id;
    const uuid = v4();

    const { data: userData } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", userId)
      .single();

    if (userData) {
      // User is already verified, let's restore their role if they don't have it
      const member = interaction.member as GuildMember;
      const newRole = interaction.guild?.roles.cache.get(NEW_WANKME_ROLE_ID);

      if (member && newRole && !member.roles.cache.has(NEW_WANKME_ROLE_ID)) {
        try {
          await member.roles.add(newRole);
          await interaction.reply({
            content: "✅ Your verified status has been restored!",
            ephemeral: true
          });
          return;
        } catch (error) {
          console.error("Error restoring role:", error);
        }
      }

      await interaction.reply({
        content: `You have already linked your account. Your linked account: \`${maskAddress(userData.address)}\``,
        ephemeral: true
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
      return;
    }

    const vercelUrl = `${process.env.VERCEL_URL}/game?token=${uuid}&discord=${userId}`;
    await interaction.reply({
      content: `Hey ${interaction.user.username}, to link your Discord account to your address click this link:\n\n${vercelUrl}`,
      ephemeral: true,
    });

    // Start watching for verification
    const checkInterval = setInterval(async () => {
      const { data: checkUser } = await supabase
        .from("users")
        .select("*")
        .eq("discord_id", userId)
        .single();

      if (checkUser) {
        clearInterval(checkInterval); // Stop checking once verified
        try {
          const member = interaction.member as GuildMember;

          // Add NEW_WANKME_ROLE
          const newRole = interaction.guild?.roles.cache.get(NEW_WANKME_ROLE_ID);
          if (member && newRole && !member.roles.cache.has(NEW_WANKME_ROLE_ID)) {
            await member.roles.add(newRole);
            console.log(`Added NEW_WANKME_ROLE to user ${userId}`);
          }

          // Remove MOOTARD_ROLE
          const mootardRole = interaction.guild?.roles.cache.get(MOOTARD_ROLE_ID);
          if (member && mootardRole && member.roles.cache.has(MOOTARD_ROLE_ID)) {
            await member.roles.remove(mootardRole);
            console.log(`Removed MOOTARD_ROLE from user ${userId}`);
          }

          // Send a followup message
          await interaction.followUp({
            content: "✅ Verification complete! Your roles have been updated.",
            ephemeral: true
          });
        } catch (error) {
          console.error('Error updating roles:', error);
        }
      }
    }, 5000); // Check every 5 seconds

    // Stop checking after 5 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 300000);
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
  // /snapshot
  // -------------------------------------------------------
  if (interaction.commandName === "snapshot") {
    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply("Guild not found.");
        return;
      }

      // Create progress message
      const progressMessage = await interaction.channel!.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle("Snapshot Progress")
            .setDescription("Starting snapshot process...")
        ]
      });

      // Fetch all verified users (with non-null address)
      let allPlayers = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        // Update progress message
        await progressMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0x0099ff)
              .setTitle("Snapshot Progress")
              .setDescription(`Fetching data... Retrieved ${allPlayers.length} users so far.`)
          ]
        });

        const { data, error } = await supabase
          .from("users")
          .select("discord_id, address, points")
          .not("address", "is", null)  // Only include verified users
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .order("points", { ascending: false });

        if (error) throw error;
        
        if (data && data.length > 0) {
          allPlayers = [...allPlayers, ...data];
          page++;
        } else {
          hasMore = false;
        }

        // Add a small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Update progress message
      await progressMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle("Snapshot Progress")
            .setDescription(`Creating CSV file with ${allPlayers.length} users...`)
        ]
      });

      // Create and save the CSV with additional role information
      const allCSV = await createCSV(allPlayers, true, guild);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const allFile = await saveCSV(allCSV, `snapshot_${timestamp}.csv`);

      // Get the statistics from the console output
      const stats = {
        totalUsers: allPlayers.length,
        originalEntries: allPlayers.length,
        afterDeduplication: new Set(allPlayers.map(p => `${p.discord_id}-${p.address}`)).size
      };

      // Final update to progress message
      await progressMessage.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle("Snapshot Complete")
            .setDescription(
              `📊 **Snapshot Statistics**\n\n` +
              `• Total Verified Users: ${stats.totalUsers}\n` +
              `• Original Entries: ${stats.originalEntries}\n` +
              `• After Deduplication: ${stats.afterDeduplication}\n\n` +
              `CSV file is ready for download below.`
            )
        ]
      });

      // Send the file
      await interaction.editReply({
        content: `Snapshot complete! Check the statistics in the message above.`,
        files: [allFile],
      });

      // Clean up the file
      fs.unlinkSync(allFile);

    } catch (error) {
      console.error("Error handling snapshot command:", error);
      await interaction.editReply("An error occurred while processing the snapshot command.");
      
      // Update progress message if it exists
      try {
        await interaction.channel!.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xFF0000)
              .setTitle("Snapshot Error")
              .setDescription(`An error occurred while creating the snapshot.\nError: ${error}`)
          ]
        });
      } catch (e) {
        console.error("Error sending error message:", e);
      }
    }
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
        .order("points", { ascending: false })
        .eq("team", teamOption);

      const { data: allUsers } = await rankQuery;
      const userRank = allUsers?.findIndex((user) => user.discord_id === interaction.user.id) ?? -1;
      const userData = allUsers?.[userRank];

      // Get paginated leaderboard data
      let query = supabase
        .from("users")
        .select("discord_id, points, team", { count: "exact" })
        .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
        .order("points", { ascending: false })
        .eq("team", teamOption);

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
        .setColor(teamOption === "bullas" ? "#22C55E" : "#EF4444");

      // Add user's rank at the top if found
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
 *      BUTTON HANDLER 
 ********************************************************************/
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

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
      .order("points", { ascending: false })
      .eq("team", teamOption);

    const { data: allUsers } = await rankQuery;
    const userRank = allUsers?.findIndex((user) => user.discord_id === interaction.user.id) ?? -1;
    const userData = allUsers?.[userRank];

    // Get paginated data
    let query = supabase
      .from("users")
      .select("discord_id, points, team", { count: "exact" })
      .not("discord_id", "in", `(${EXCLUDED_USER_IDS.join(",")})`)
      .order("points", { ascending: false })
      .eq("team", teamOption);

    const { data: leaderboardData, count, error } = await query.range(skip, skip + itemsPerPage - 1);
    if (error) throw error;

    const totalPages = Math.ceil((count || 0) / itemsPerPage);

    const leaderboardEmbed = new EmbedBuilder()
      .setColor(teamOption === "bullas" ? "#22C55E" : "#EF4444");

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
