const {
    Client,
    GatewayIntentBits,
    Routes,
    REST,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder
} = require("discord.js");
const sqlite = require("sqlite3").verbose();
require("dotenv").config();

const TOKEN = process.env.TOKEN;

const OWNERS = process.env.OWNERS ?
    process.env.OWNERS.split(",").map(id => id.trim()) :
    [];

function isOwner(userId) {
    return OWNERS.includes(userId);
}

const EPHEMERAL = 64;

const CHRISTMAS_GIF = "https://media4.giphy.com/media/v1.Y2lkPTZjMDliOTUyemUxYmczN3FsZXVmdnl4eXRiajQ2d2J3bmFpbm1rdjNxbGZ4ZWJwYyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/SSiXSDrxlfohtQ7Irn/giphy.gif";
const db = new sqlite.Database("./database.sqlite", () => {
    db.run("CREATE TABLE IF NOT EXISTS advent_rewards (day INTEGER PRIMARY KEY, role_id TEXT, win_text TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS advent_claims (user_id TEXT, day INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS advent_logs (guild_id TEXT PRIMARY KEY, channel_id TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS advent_blacklist (guild_id TEXT, user_id TEXT)");
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const commands = [

    new SlashCommandBuilder()
    .setName("calendrier")
    .setDescription("Envoie le calendrier de l'avent dans un salon.")
    .addChannelOption(opt =>
        opt.setName("salon")
        .setDescription("Salon où envoyer le calendrier.")
        .setRequired(true)
    ),

    new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Définir le salon de logs des récompenses.")
    .addChannelOption(opt =>
        opt.setName("salon")
        .setDescription("Salon de logs du calendrier.")
        .setRequired(true)
    ),

    new SlashCommandBuilder()
    .setName("récompense")
    .setDescription("Gérer les récompenses du calendrier.")
    .addSubcommand(sub =>
        sub
        .setName("set")
        .setDescription("Définir une récompense pour un jour.")
        .addIntegerOption(opt =>
            opt.setName("jour")
            .setDescription("Jour (1-25)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(25)
        )
        .addRoleOption(opt =>
            opt.setName("role")
            .setDescription("Rôle gagné.")
            .setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName("win")
            .setDescription("Texte gagné.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
        sub
        .setName("show")
        .setDescription("Afficher les récompenses configurées avec pagination.")
    )
    .addSubcommand(sub =>
        sub
        .setName("clear")
        .setDescription("Réinitialiser toutes les récompenses du calendrier.")
    ),

    new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Gérer la blacklist du calendrier.")
    .addSubcommand(sc =>
        sc.setName("add")
        .setDescription("Ajouter un utilisateur à la blacklist.")
        .addUserOption(opt =>
            opt.setName("user").setDescription("Utilisateur à blacklister").setRequired(true)
        )
    )
    .addSubcommand(sc =>
        sc.setName("remove")
        .setDescription("Retirer un utilisateur de la blacklist.")
        .addUserOption(opt =>
            opt.setName("user").setDescription("Utilisateur à retirer").setRequired(true)
        )
    )
    .addSubcommand(sc =>
        sc.setName("list")
        .setDescription("Liste des utilisateurs blacklistés.")
    )
    .addSubcommand(sc =>
        sc.setName("clear")
        .setDescription("Réinitialiser entièrement la blacklist.")
    )

].map(c => c.toJSON());

client.once(Events.ClientReady, async () => {
    console.log(`Connecté en tant que ${client.user.tag}`);

    const rest = new REST({
        version: "10"
    }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands
    });

    console.log("Toutes les commandes ont été chargées !");
});

function buildChristmasLog(description) {
    return new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("Logs du Calendrier de l'Avent")
        .setURL("https://guns.lol/hmihouse")
        .setThumbnail(CHRISTMAS_GIF)
        .setImage(CHRISTMAS_GIF)
        .setDescription(description);
}

function buildDjibrilEmbed(desc) {
    return new EmbedBuilder()
        .setColor("#2F3136")
        .setDescription(desc);
}

function getCalendarEndTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const endDate = new Date(year, 11, 25, 23, 59, 0);
    return Math.floor(endDate.getTime() / 1000);
}

function canUserClaimDay(userId, day) {
    const now = new Date();
    const month = now.getMonth();
    const today = now.getDate();

    if (isOwner(userId)) return {
        allowed: true,
        reason: "OWNER"
    };

    if (month !== 11)
        return {
            allowed: false,
            reason: "NOT_DECEMBER"
        };

    if (day > today)
        return {
            allowed: false,
            reason: "DAY_FUTURE"
        };

    return {
        allowed: true,
        reason: "OK"
    };
}

const REWARDS_PER_PAGE = 5;
const MAX_DAYS = 25;
const MAX_PAGES = Math.ceil(MAX_DAYS / REWARDS_PER_PAGE);

function buildRewardsPageEmbed(page, rewardsByDay) {
    const startDay = (page - 1) * REWARDS_PER_PAGE + 1;
    const endDay = Math.min(page * REWARDS_PER_PAGE, MAX_DAYS);

    let desc = "Voici les récompenses actuellement configurées pour le calendrier :\n\n";

    for (let d = startDay; d <= endDay; d++) {
        const r = rewardsByDay[d];
        desc += `**Jour ${d}**\n`;
        if (!r) {
            desc += "• Aucune récompense définie.\n\n";
        } else {
            const hasText = !!r.win_text;
            const hasRole = !!r.role_id;
            if (hasText) {
                desc += `• Texte : **${r.win_text}**\n`;
            } else {
                desc += "• Texte : Aucune\n";
            }
            if (hasRole) {
                desc += `• Rôle : <@&${r.role_id}>\n\n`;
            } else {
                desc += "• Rôle : Aucun\n\n";
            }
        }
    }

    return new EmbedBuilder()
        .setColor("#FF0000")
        .setTitle("Liste des récompenses")
        .setDescription(desc)
        .setFooter({
            text: `Page ${page} / ${MAX_PAGES}`
        });
}

function buildRewardsPageComponents(page) {
    const row = new ActionRowBuilder();
    if (page > 1) {
        row.addComponents(
            new ButtonBuilder()
            .setCustomId(`rewardshow_prev_${page}`)
            .setLabel("◀️")
            .setStyle(ButtonStyle.Secondary)
        );
    }
    if (page < MAX_PAGES) {
        row.addComponents(
            new ButtonBuilder()
            .setCustomId(`rewardshow_next_${page}`)
            .setLabel("▶️")
            .setStyle(ButtonStyle.Secondary)
        );
    }

    return row.components.length > 0 ? [row] : [];
}

client.on(Events.InteractionCreate, async interaction => {

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith("advent_")) {
            const dayStr = customId.split("_")[1];
            const day = parseInt(dayStr, 10);

            db.get(
                "SELECT * FROM advent_blacklist WHERE guild_id = ? AND user_id = ?",
                [interaction.guild.id, interaction.user.id],
                async (err, blk) => {
                    if (blk) {
                        return interaction.reply({
                            content: "Vous n'êtes plus le bienvenu à cet événement, vous ne pouvez vous en prendre qu'à vous-même !",
                            flags: EPHEMERAL
                        });
                    }

                    db.get("SELECT * FROM advent_rewards WHERE day = ?", [day], async (err2, reward) => {
                        if (!reward) {
                            return interaction.reply({
                                content: "Pas de récompense définie pour ce jour-ci !",
                                flags: EPHEMERAL
                            });
                        }

                        const check = canUserClaimDay(interaction.user.id, day);
                        if (!check.allowed) {
                            if (check.reason === "NOT_DECEMBER") {
                                return interaction.reply({
                                    content: "Ce calendrier n'est accessible qu'en décembre.",
                                    flags: EPHEMERAL
                                });
                            }

                            if (check.reason === "DAY_FUTURE") {
                                return interaction.reply({
                                    content: "Vous ne pouvez pas encore récupérer cette récompense.",
                                    flags: EPHEMERAL
                                });
                            }

                            return interaction.reply({
                                content: "Vous ne pouvez pas récupérer cette récompense pour le moment.",
                                flags: EPHEMERAL
                            });
                        }
                        db.get(
                            "SELECT * FROM advent_claims WHERE user_id = ? AND day = ?",
                            [interaction.user.id, day],
                            async (err3, claim) => {
                                if (claim) {
                                    return interaction.reply({
                                        content: "Vous avez déjà récupéré ce jour.",
                                        flags: EPHEMERAL
                                    });
                                }

                                db.run("INSERT INTO advent_claims (user_id, day) VALUES (?, ?)", [
                                    interaction.user.id,
                                    day
                                ]);

                                let finalMsg = `Vous venez de récupérer le jour **${day}** !`;
                                const hasRole = !!reward.role_id;
                                const hasText = !!reward.win_text;
                                let roleGiven = false;
                                let roleError = false;

                                if (hasRole && hasText) finalMsg += ` Vous gagnez **${reward.win_text}** et le rôle <@&${reward.role_id}>.`;
                                else if (hasRole) finalMsg += ` Vous gagnez le rôle <@&${reward.role_id}>.`;
                                else if (hasText) finalMsg += ` Vous gagnez **${reward.win_text}**.`;

                                if (hasRole) {
                                    try {
                                        const role = interaction.guild.roles.cache.get(reward.role_id);
                                        const member = interaction.guild.members.cache.get(interaction.user.id);
                                        await member.roles.add(role);
                                        roleGiven = true;
                                    } catch {
                                        roleError = true;
                                    }
                                }

                                await interaction.reply({
                                    content: finalMsg,
                                    flags: EPHEMERAL
                                });

                                // LOGS
                                db.get("SELECT * FROM advent_logs WHERE guild_id = ?", [interaction.guild.id], (err4, logs) => {
                                    if (!logs) return;

                                    const channel = interaction.guild.channels.cache.get(logs.channel_id);
                                    if (!channel) return;

                                    const now = Math.floor(Date.now() / 1000);
                                    const end = getCalendarEndTimestamp();

                                    let desc = "";
                                    desc += "━━━━━━━━━━ ``🎄`` **CALENDRIER — CLAIM** ``🎄`` ━━━━━━━━━━\n\n";
                                    desc += "``👤`` Utilisateur : <@" + interaction.user.id + ">\n";
                                    desc += "``📆`` Jour récupéré : **" + day + "**\n\n";

                                    if (hasRole && hasText) {
                                        desc += "``🎁`` Récompense : Texte + Rôle\n";
                                        desc += "→ Texte : **" + reward.win_text + "**\n";
                                        desc += "→ Rôle : <@&" + reward.role_id + ">\n\n";
                                    } else if (hasRole) {
                                        desc += "``🎁`` Récompense : Rôle uniquement\n";
                                        desc += "→ Rôle : <@&" + reward.role_id + ">\n\n";
                                    } else {
                                        desc += "``🎁`` Récompense : Texte uniquement\n";
                                        desc += "→ Texte : **" + reward.win_text + "**\n\n";
                                    }

                                    desc += "``📅`` Récupéré le : <t:" + now + ":F>\n";
                                    desc += "``🎄`` Fin du calendrier : <t:" + end + ":F>\n";

                                    if (roleError) {
                                        desc += "\n``⚠️`` Impossible d'attribuer le rôle à l'utilisateur.\n";
                                    }

                                    desc += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

                                    channel.send({
                                        embeds: [buildChristmasLog(desc)]
                                    });
                                });
                            }
                        );
                    });
                }
            );

            return;
        }

        if (customId.startsWith("rewardshow_")) {
            if (!isOwner(interaction.user.id)) {
                return interaction.reply({
                    content: "Non autorisé.",
                    flags: EPHEMERAL
                }).catch(() => {});
            }

            const parts = customId.split("_"); // rewardshow, prev|next, page
            const direction = parts[1];
            const currentPage = parseInt(parts[2], 10);

            let newPage = currentPage;
            if (direction === "next") newPage++;
            if (direction === "prev") newPage--;

            if (newPage < 1 || newPage > MAX_PAGES) return;

            db.all("SELECT * FROM advent_rewards", [], (err, rows) => {
                const rewardsByDay = {};
                if (rows && rows.length > 0) {
                    for (const r of rows) {
                        rewardsByDay[r.day] = r;
                    }
                }

                const embed = buildRewardsPageEmbed(newPage, rewardsByDay);
                const components = buildRewardsPageComponents(newPage);

                return interaction.update({
                    embeds: [embed],
                    components
                }).catch(() => {});
            });

            return;
        }

        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!isOwner(interaction.user.id))
        return interaction.reply({
            content: "Commande réservée aux owners.",
            flags: EPHEMERAL
        });

    if (interaction.commandName === "calendrier") {
        const salon = interaction.options.getChannel("salon");
        const endTs = getCalendarEndTimestamp();

        const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("Calendrier de l'Avent")
            .setImage("https://image.over-blog.com/fg92pBbWaQ_ubE6Gdkp-Td7z3yo=/filters:no_upscale()/image%2F1181376%2F20201119%2Fob_67a007_5c-tubes-gifs-calendriers-de-l-avent.gif")
            .setDescription([
                "Bienvenue sur le **Calendrier de l'Avent** du serveur.",
                "",
                "• Cliquez sur le bouton correspondant au jour souhaité.",
                "• Accessible uniquement en décembre (jours ≤ jour actuel).",
                "• Les owners peuvent tout récupérer sans restrictions.",
                "",
                "• Fin du calendrier : <t:" + endTs + ":F>",
                "",
                "Bonne chance et bonnes fêtes !"
            ].join("\n"))
            .setFooter({
                text: "Calendrier de l'Avent — 25 jours"
            });

        const rows = [];
        let row = new ActionRowBuilder();
        for (let i = 1; i <= MAX_DAYS; i++) {
            row.addComponents(
                new ButtonBuilder()
                .setCustomId("advent_" + i)
                .setLabel(String(i))
                .setStyle(ButtonStyle.Danger)
            );
            if (row.components.length === 5) {
                rows.push(row);
                row = new ActionRowBuilder();
            }
        }
        if (row.components.length > 0) rows.push(row);

        await salon.send({
            embeds: [embed],
            components: rows
        });

        return interaction.reply({
            content: "Calendrier envoyé.",
            flags: EPHEMERAL
        });
    }

    if (interaction.commandName === "setlogs") {
        const salon = interaction.options.getChannel("salon");

        db.run("INSERT OR REPLACE INTO advent_logs (guild_id, channel_id) VALUES (?, ?)", [
            interaction.guild.id,
            salon.id
        ]);

        return interaction.reply({
            content: "Salon de logs configuré.",
            flags: EPHEMERAL
        });
    }

    if (interaction.commandName === "récompense") {
        const sub = interaction.options.getSubcommand();

        if (sub === "set") {
            const jour = interaction.options.getInteger("jour");
            const role = interaction.options.getRole("role");
            const win = interaction.options.getString("win");

            if (!role && !win)
                return interaction.reply({
                    content: "Vous devez fournir au minimum un rôle OU un texte.",
                    flags: EPHEMERAL
                });

            db.run(
                "INSERT OR REPLACE INTO advent_rewards (day, role_id, win_text) VALUES (?, ?, ?)",
                [jour, role ? role.id : null, win || null]
            );

            return interaction.reply({
                content: "Récompense du jour " + jour + " configurée.",
                flags: EPHEMERAL
            });
        }

        if (sub === "show") {
            db.all("SELECT * FROM advent_rewards", [], (err, rows) => {
                const rewardsByDay = {};
                if (rows && rows.length > 0) {
                    for (const r of rows) {
                        rewardsByDay[r.day] = r;
                    }
                }

                const page = 1;
                const embed = buildRewardsPageEmbed(page, rewardsByDay);
                const components = buildRewardsPageComponents(page);

                return interaction.reply({
                    embeds: [embed],
                    components,
                    flags: EPHEMERAL
                });
            });

            return;
        }

        if (sub === "clear") {
            db.run("DELETE FROM advent_rewards", [], () => {
                return interaction.reply({
                    content: "Toutes les récompenses ont été réinitialisées.",
                    flags: EPHEMERAL
                });
            });
            return;
        }
    }

    if (interaction.commandName === "blacklist") {
        const sub = interaction.options.getSubcommand();

        if (sub === "add") {
            const user = interaction.options.getUser("user");

            if (user.id === interaction.user.id) {
                return interaction.reply({
                    content: "Vous ne pouvez pas vous ajouter vous-même à la blacklist.",
                    flags: EPHEMERAL
                });
            }

            if (isOwner(user.id)) {
                return interaction.reply({
                    content: "Impossible de blacklist un owner.",
                    flags: EPHEMERAL
                });
            }

            db.run(
                "INSERT INTO advent_blacklist (guild_id, user_id) VALUES (?, ?)",
                [interaction.guild.id, user.id],
                () => {
                    db.get("SELECT * FROM advent_logs WHERE guild_id = ?", [interaction.guild.id], (err, logs) => {
                        if (!logs) return;
                        const channel = interaction.guild.channels.cache.get(logs.channel_id);
                        if (!channel) return;

                        const now = Math.floor(Date.now() / 1000);
                        let desc = "";
                        desc += "━━━━━━━━━━ ``⛔`` **BLACKLIST — AJOUT** ``⛔`` ━━━━━━━━━━\n\n";
                        desc += "``👤`` Utilisateur ajouté : <@" + user.id + ">\n";
                        desc += "``📅`` Date : <t:" + now + ":F>\n";
                        desc += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

                        channel.send({
                            embeds: [buildChristmasLog(desc)]
                        });
                    });

                    return interaction.reply({
                        content: "L’utilisateur <@" + user.id + "> a été ajouté à la blacklist.",
                        flags: EPHEMERAL
                    });
                }
            );
        }

        if (sub === "remove") {
            const user = interaction.options.getUser("user");

            db.run(
                "DELETE FROM advent_blacklist WHERE guild_id = ? AND user_id = ?",
                [interaction.guild.id, user.id],
                () => {
                    db.get("SELECT * FROM advent_logs WHERE guild_id = ?", [interaction.guild.id], (err, logs) => {
                        if (!logs) return;
                        const channel = interaction.guild.channels.cache.get(logs.channel_id);
                        if (!channel) return;

                        const now = Math.floor(Date.now() / 1000);
                        let desc = "";
                        desc += "━━━━━━━━━━ ``🟢`` **BLACKLIST — RETRAIT** ``🟢`` ━━━━━━━━━━\n\n";
                        desc += "``👤`` Utilisateur retiré : <@" + user.id + ">\n";
                        desc += "``📅`` Date : <t:" + now + ":F>\n";
                        desc += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

                        channel.send({
                            embeds: [buildChristmasLog(desc)]
                        });
                    });

                    return interaction.reply({
                        content: "L’utilisateur <@" + user.id + "> a été retiré de la blacklist.",
                        flags: EPHEMERAL
                    });
                }
            );
        }

        if (sub === "list") {
            db.all(
                "SELECT * FROM advent_blacklist WHERE guild_id = ?",
                [interaction.guild.id],
                (err, rows) => {
                    if (!rows || rows.length === 0) {
                        const embed = buildDjibrilEmbed("``✨`` Aucun utilisateur dans la blacklist.");
                        return interaction.reply({
                            embeds: [embed],
                            flags: EPHEMERAL
                        });
                    }

                    let desc = "``⛔`` Utilisateurs blacklistés :\n\n";
                    rows.forEach(r => {
                        desc += "• <@" + r.user_id + ">\n";
                    });
                    desc += "\nTotal : **" + rows.length + "**";

                    const embed = buildDjibrilEmbed(desc);
                    return interaction.reply({
                        embeds: [embed],
                        flags: EPHEMERAL
                    });
                }
            );
        }

        if (sub === "clear") {
            db.run(
                "DELETE FROM advent_blacklist WHERE guild_id = ?",
                [interaction.guild.id],
                () => {
                    // log
                    db.get("SELECT * FROM advent_logs WHERE guild_id = ?", [interaction.guild.id], (err, logs) => {
                        if (!logs) return;

                        const channel = interaction.guild.channels.cache.get(logs.channel_id);
                        if (!channel) return;

                        const now = Math.floor(Date.now() / 1000);
                        let desc = "";
                        desc += "━━━━━━━━━━ ``🧹`` **BLACKLIST — CLEAR** ``🧹`` ━━━━━━━━━━\n\n";
                        desc += "``🗑️`` Tous les utilisateurs ont été retirés de la blacklist.\n";
                        desc += "``📅`` Date : <t:" + now + ":F>\n";
                        desc += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

                        channel.send({
                            embeds: [buildChristmasLog(desc)]
                        });
                    });

                    return interaction.reply({
                        content: "Blacklist entièrement réinitialisée.",
                        flags: EPHEMERAL
                    });
                }
            );
        }
    }
});

client.login(TOKEN);
