import * as nr from "../NewRouter";

nr.addDocsWebPage(
	"/about",
	"about inter·punct",
	"inter·punct is a discord bot created by pfg#4865",
	`inter·punct is a discord bot created by pfg#4865 that does a few things. For more information, see help: {LinkDocs|/help}

{Heading|invite to your server}
{Link|https://discordapp.com/oauth2/authorize?client_id=433078185555656705&permissions=268445780&scope=bot}
Not all commands require all permissions. Pick and choose only the permissions you need.

{Heading|support server}
{Link|https://interpunct.bot/support}

{Heading|links}
top.gg (please vote): {Link|https://top.gg/bot/433078185555656705}
discord.bots.gg: {Link|https://discord.bots.gg/bots/433078185555656705}

{Heading|source code}
{Link|https://github.com/pfgithub/interpunctbot}
{Interpunct} is open source. Unfortunately, that doesn't mean the code is good.`,
);

/*
other bot lists:
botsfordiscord.com
bots.ondiscord.xyz
discord.boats
discordbotlist.com
*/

nr.globalCommand(
	"/help/about",
	"about",
	{
		usage: "about",
		description: "displays information about the bot",
		examples: [],
		perms: {},
	},
	nr.list(),
	async ([], info) => {
		await info.docs("/about", "full");
	},
);
