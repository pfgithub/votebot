import client, { timedEvents } from "../bot";
import * as discord from "discord.js";
import { ilt, production } from "..";
import { globalConfig } from "./config";
import Info, {MessageLike} from "./Info";
import { globalCommandNS, globalDocs } from "./NewRouter";
import deepEqual from "deep-equal";

const api = client as any as ApiHolder;

type ApiHandler = {
    get: <T>() => Promise<T>;
    post: <T, Q>(value: T) => Promise<Q>;
    patch: (value: any) => Promise<any>;
    delete: () => Promise<any>;
} & {[key: string]: ApiHandler} & ((...data: any[]) => ApiHandler);

type ApiHolder = {api: ApiHandler};

type UsedCommandOption = {
    name: string;
    options?: UsedCommandOption[];
    value?: string;
};
type UsedCommand = {
    name: string;
    id: string;
    options?: UsedCommandOption[];
};

export type DiscordInteraction = {
    id: string; // interaction id
    token: string; // interaction token
    guild_id: string;
    channel_id: string;
    member: {user: {id: string}}; // TODO add this to the discord member cache // in the future this will be done automatically so nah
    data: UsedCommand;
};

type SlashCommandOptionNameless = {
    type: 2;
    description: string;
    options: SlashCommandOption[];
} | {
    type: 1;
    description: string;
    options?: SlashCommandOption[];
} | {
    // string
    type: 3;
    description: string;
    required: boolean;
    choices?: {name: string; value: string}[];
} | {
    // boolean. this is pretty much useless and string should always be used instead.
    type: 5;
    description: string;
    required: boolean;
} | {
    // channel.
    type: 7;
    description: string;
    required: boolean;
};
type SlashCommandOption = SlashCommandOptionNameless & {
    name: string;
}
type SlashCommandNameless = {
    description: string;
    options?: SlashCommandOption[];
};
type SlashCommandUser = SlashCommandNameless & {
    name: string;
};
type SlashCommand = SlashCommandUser & {
    id: string;
    application_id: string;
};

export class InteractionHelper {
    raw_interaction: DiscordInteraction;
    has_ackd: boolean;

    constructor(raw_interaction: DiscordInteraction) {
        this.raw_interaction = raw_interaction;
        this.has_ackd = false;
    }
    async sendRaw(value: object) {
        if(this.has_ackd) throw new Error("cannot double interact");
        this.has_ackd = true;
        await api.api.interactions(this.raw_interaction.id, this.raw_interaction.token).callback.post({data: value});
    }
    async accept() {
        await this.sendRaw({
            type: 5,
        });
    }
    async acceptHideCommand() {
        await this.sendRaw({
            type: 2,
        });
    }
    async replyHidden(message: string) {
        try {
            await this.sendRaw({
                type: 4,
                data: {content: message, flags: 1 << 6},
            });
        }catch(e) {
            console.log(e);
            await this.accept();
        }
    }
    async replyHiddenHideCommand(message: string) {
        try {
            await this.sendRaw({
                type: 2,
                data: {content: message, flags: 1 << 6},
            });
        }catch(e) {
            console.log(e);
            await this.acceptHideCommand();
        }
    }
}

function on_interaction(interaction: DiscordInteraction) {
    ilt(do_handle_interaction(interaction), false).then(async res => {
        if(res.error) {
            console.log("handle interaction failed with", res.error);
            await api.api.webhooks(client.user!.id, interaction.token).post({data: {
                content: "Uh oh! Something went wrong while handling this interaction",
            }});
            return;
        }
    }).catch(e => console.log("handle interaction x2 failed", e));
}
async function handle_interaction_routed(info: Info, route_name: string, route: SlashCommandRoute, options: UsedCommandOption[], interaction: InteractionHelper): Promise<unknown> {
    if('subcommands' in route) {
        // read option
        if(options.length !== 1) return await info.error("Expected subcommand. This should never happen.");
        const opt0 = options[0];
        const optnme = opt0.name;

        const next_route = route.subcommands[optnme];
        if(!next_route) return await info.error(info.tag`Subcommand ${optnme} not found. This should never happen.`);

        return await handle_interaction_routed(info, optnme, next_route, opt0.options ?? [], interaction);
    }else{
        // (subcommand.options || []).map(opt => opt.value || ""
        const ns_path = route.route ?? route_name;

        const handler = globalCommandNS[ns_path];
        if(!handler) return await info.error("Could not find handler for ns_path `"+ns_path+"`. This should never happen.");

        if(!handler.config.supports_slash) {
            await interaction.accept();
        }

        return handler.handler((options || []).map(opt => opt.value || "").join(" "), info);
    }
}
async function do_handle_interaction(interaction: DiscordInteraction) {
    const startTime = Date.now();

    console.log("Got interaction: ", require("util").inspect(interaction.data, false, null, true));
    // construct an info object
    const guild = client.guilds.cache.get(interaction.guild_id)!;
    const channel = client.channels.cache.get(interaction.channel_id)! as discord.Message["channel"];
    const member = guild.members.add(interaction.member);

    const mlike: MessageLike = {
        channel,
        guild,
        member,
        author: member.user,
        client,
        content: "*no content*",
        delete: async () => {
            // nothing to do.
        },
    };
    const interaction_helper = new InteractionHelper(interaction);
    const info = new Info(mlike, timedEvents!, {
        startTime,
        infoPerSecond: -1,
        raw_interaction: interaction_helper,
    });

    const data = interaction.data;

    const route = slash_command_router[data.name];
    if(!route) return await info.error("Unsupported interaction / This command should not exist.");

    return await handle_interaction_routed(info, data.name, route, data.options || [], interaction_helper);
}

type SlashCommandRouteBottomLevel = {
    route?: string;
    description?: string; // if no description is specified, it will be chosen from the route
    args?: {[key: string]: SlashCommandOptionNameless};
    arg_stringifier?: (args: UsedCommandOption[]) => string;
};
type SlashCommandRouteSubcommand = {
    description: string;
    subcommands: {[key: string]: SlashCommandRouteBottomLevel} | {[key: string]: SlashCommandRouteSubcommand};
};
type SlashCommandRoute = SlashCommandRouteBottomLevel | SlashCommandRouteSubcommand;

const opt = {
    oneOf(description: string, choices: {[key: string]: string}): SlashCommandOptionNameless {
        if(description.length > 100) throw new Error("max 100 len desc");
        return {
            type: 3,
            description,
            required: true,
            choices: Object.entries(choices).map(([value, key]) => ({name: key, value})),
        }
    },
    channel(description: string): SlashCommandOptionNameless {
        if(description.length > 100) throw new Error("max 100 len desc");
        return {type: 7, description, required: true};
    },
    string(description: string): SlashCommandOptionNameless {
        if(description.length > 100) throw new Error("max 100 len desc");
        return {type: 3, description, required: true};
    },
    // TODO update when discord adds multiline support
    multiline(description: string): SlashCommandOptionNameless {
        if(description.length > 100) throw new Error("max 100 len desc");
        return {type: 3, description, required: true};
    },
    optional(scon: SlashCommandOptionNameless): SlashCommandOptionNameless {
        return {...scon, required: false} as any;
    },
};

const slash_command_router: {[key: string]: SlashCommandRoute} = {
    test: {},
    play: {
        description: "Play a game",
        subcommands: {
            connect4: {}, minesweeper: {},
            papersoccer: {}, ultimatetictactoe: {},
            checkers: {}, circlegame: {},
            tictactoe: {},
            randomword: {args: {custom_word: opt.optional(opt.string("A custom word. Costs 5 trophies."))}},
            trivia: {}, needle: {},
        },
    },
    set: {
        description: "Configure bot",
        subcommands: {
            prefix: {args: {to: opt.string("the new bot prefix. default is ip!")}},
            fun: {args: {to: opt.oneOf("allow or deny fun", {enable: "On", disable: "Off"})}},
        },
    },
    messages: {
        description: "Configure messages",
        subcommands: {
            user_join: {
                description: "Set/remove join message",
                subcommands: {
                    set: {route: "messages set welcome", args: {
                        channel: opt.channel("Channel to send join messages in"),
                        message: opt.multiline("Join message. Use `{Mention}` or `{Name}` to include the name of the joiner."),
                    }},
                    off: {route: "messages remove welcome"},
                },
            },
            user_leave: {
                description: "Set/remove leave message",
                subcommands: {
                    set: {route: "messages set goodbye", args: {
                        channel: opt.channel("Channel to send leave messages in"),
                        message: opt.multiline("Use `{Mention}` or `{Name}` to include the name of the leaver."),
                    }},
                    off: {route: "messages remove goodbye"},
                },
            },
            pinbottom: {
                route: "pinbottom",
                args: {channel: opt.channel("Channel to pin the message in"), message: opt.optional(opt.multiline("Message to pin"))},
            },
        },
    }
};

const global_slash_commands: {[key: string]: SlashCommandNameless} = {};

function createBottomLevelCommand(cmdname: string, cmddata: SlashCommandRouteBottomLevel): SlashCommandUser {
    const base_command_name = cmddata.route ?? cmdname;
    const base_command = globalCommandNS[base_command_name];
    if(!base_command) throw new Error("Undefined command `"+base_command_name+"`");
    const base_command_docs = globalDocs[base_command.docsPath];
    const docs_desc = base_command_docs.summaries.description;

    if(cmddata.description && cmddata.description.length > 100) throw new Error("max length 100");
    let final_desc = cmddata.description ?? docs_desc;
    if(final_desc.length > 100) final_desc = final_desc.substr(0, 99) + "…";

    return {
        name: cmdname,
        description: final_desc,
        options: Object.entries(cmddata.args ?? {}).map(([optname, optvalue]) => {
            return {...optvalue, name: optname};
        }),
    };
}

for(const [cmdname, cmddata] of Object.entries(slash_command_router)) {
    if('subcommands' in cmddata) {
        global_slash_commands[cmdname] = {
            description: cmddata.description,
            options: Object.entries(cmddata.subcommands).map(([scname, scdata_raw]) => {
                const scdata = scdata_raw as SlashCommandRouteBottomLevel | SlashCommandRouteSubcommand;
                if('subcommands' in scdata) {
                    return {
                        type: 2,
                        name: scname,
                        description: scdata.description,
                        options: Object.entries(scdata.subcommands).map(([sscname, sscdata_raw]) => {
                            if('subcommands' in sscdata_raw) throw new Error("too nested!");
                            const sscdata = sscdata_raw as SlashCommandRouteBottomLevel;
                            return {type: 1, ...createBottomLevelCommand(sscname, sscdata)};
                        }),
                    };
                } else {
                    return {type: 1, ...createBottomLevelCommand(scname, scdata)};
                }
            }),
        };
        continue;
    }
    const v = createBottomLevelCommand(cmdname, cmddata);
    global_slash_commands[cmdname] = v;
}

if(Object.entries(global_slash_commands).length > 50) throw new Error("Max 50 slash commands");

let __is_First_Shard: boolean | undefined = undefined;
function firstShard() {
    if(__is_First_Shard !== undefined) return __is_First_Shard;
    const values = client.guilds.cache.values();
    const first = values.next();
    if(first.done) return false;
    __is_First_Shard = first.value.shardID == 0;
    return __is_First_Shard;
}

function shouldUpdateCommandsHere() {
    if(production) return firstShard();
    return !!devCommandGuild;
}

const devCommandGuild = globalConfig.slashCommandServer;
async function getCommands(): Promise<SlashCommand[]> {
    if(!shouldUpdateCommandsHere()) throw new Error("Not supposed to update commands here");
    if(production) {
        return await api.api.applications(client.user!.id).commands.get<SlashCommand[]>();
    }else{
        return await api.api.applications(client.user!.id).guilds(devCommandGuild).commands.get<SlashCommand[]>();
    }
}

async function addCommand(command_data: SlashCommandUser): Promise<SlashCommand> {
    if(!shouldUpdateCommandsHere()) throw new Error("Not supposed to update commands here");
    if(production) {
        return await api.api.applications(client.user!.id).commands.post<{data: SlashCommandUser}, SlashCommand>({data: command_data});
    }else{
        return await api.api.applications(client.user!.id).guilds(devCommandGuild).commands.post<{data: SlashCommandUser}, SlashCommand>({data: command_data});
    }
}

async function removeCommand(command_id: string): Promise<void> {
    if(!shouldUpdateCommandsHere()) throw new Error("Not supposed to update commands here");
    if(production) {
        await api.api.applications(client.user!.id).commands(command_id).delete();
    }else{
        await api.api.applications(client.user!.id).guilds(devCommandGuild).commands(command_id).delete();
    }
}

function compareOptions(remote: SlashCommandOption[], local: SlashCommandOption[]): "same" | "different" {
    if(deepEqual(local, remote)) return "same";
    return "different";
}

function compareCommands(remote: SlashCommand, local: SlashCommandUser): "same" | "different" {
    if(remote.description !== local.description) return "different";
    if(compareOptions(remote.options ?? [], local.options ?? []) === "different") return "different";
    return "same";
}

export async function start() {
    // get list of global slash commands
    // update to match

    client.ws.on("INTERACTION_CREATE" as any, on_interaction);

    // NOTE that this only has to be done on shard 0
    if(!shouldUpdateCommandsHere()) {
        console.log("Not updating slash commands on this shard/config");
        return;
    }

    const current_slash_commands = await getCommands();

    // console.log("Current slash commands: ",current_slash_commands);
    // update slash commands to match global slash commands

    for(const remote of current_slash_commands) {
        const local_user = global_slash_commands[remote.name];
        if(!local_user) {
            console.log("Removing command: "+remote.name+" (id "+remote.id+")");
            await removeCommand(remote.id);
            console.log("√ Removed");
            continue;
        }
        const local = {...local_user, name: remote.name};
        if(compareCommands(remote, local) == "different") {
            console.log("Updating command: "+remote.name+" (id "+remote.id+")");
            const res = await addCommand(local);
            console.log("√ Edited", res);
            continue;
        }
    }
    for(const [cmd_name, new_command] of Object.entries(global_slash_commands)) {
        const cmd_full: SlashCommandUser = {...new_command, name: cmd_name};
        if(!current_slash_commands.find(csc => csc.name == cmd_name)) {
            console.log("Adding new command: "+cmd_name);
            const res = await addCommand(cmd_full);
            console.log("√ Added", res);
        }
    }
    console.log("Slash commands up to date!");
}