import * as Discord from "discord.js";
import * as config from "./config.json";
const bot = new Discord.Client({ disableEveryone: true });

const token = config.token;

bot.login(token);

export default bot;
