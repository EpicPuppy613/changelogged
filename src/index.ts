import { Mwn } from "mwn";
import { readFileSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { Chalk } from "chalk";

const ch = new Chalk();

// Read config file
const config = JSON.parse(readFileSync("./config.json", "utf-8")) as {
	username?: string;
	password?: string;
};

if (!config.username || !config.password) {
	throw new Error(
		"Config file is incomplete! Please create a 'config.json' and provide a bot 'username' and 'password'.",
	);
}

console.log("Using bot username: " + config.username);

// Initialize bot and connect to wiki
const bot = await Mwn.init({
	apiUrl: "https://mcnations.wiki.gg/api.php",

	username: config.username,
	password: config.password,

	userAgent:
		"Changelogged v0.1 ([https://github.com/EpicPuppy613/changelogged])",
});

interface VersionResponse {
	title: {
		version: string;
		timeindex: number;
	};
}

interface ChangeResponse {
	title: {
		version: string;
		affected: string;
		changed: string;
	};
}

// Retrieve all changelogs
console.log(ch.gray("[INFO] Retrieving Changelog Data..."));
const versions: VersionResponse[] = (
	await bot.request({
		action: "cargoquery",
		format: "json",
		tables: "Versions",
		fields: "_pageName=version,timeindex",
		formatversion: "2",
	})
).cargoquery;
// Retrieve all changes
const changes: ChangeResponse[] = (
	await bot.request({
		action: "cargoquery",
		format: "json",
		tables: "Changes",
		fields: "_pageName=version,affected,changed",
		limit: "max",
		formatversion: "2",
	})
).cargoquery;

// Map versions to linear order
const versionOrder = versions.sort(
	(a, b) => a.title.timeindex - b.title.timeindex,
);
// Create reference map from version string to index
const versionMap: { [key: string]: number } = {};
for (let i = 0; i < versionOrder.length; i++) {
	versionMap[versionOrder[i].title.version] = i;
}
const latest = versionOrder[versionOrder.length - 1];

interface PageOverview {
	page: string;
	changes: { [key: number]: string[] };
}

// Parse changes and assemble page overviews
const pages: { [key: string]: PageOverview } = {};
for (const change of changes) {
	// Create new page overview if the page overview doesn't exist
	if (!pages[change.title.affected]) {
		pages[change.title.affected] = {
			page: change.title.affected,
			changes: {},
		};
	}
	const page = pages[change.title.affected];
	const verindex = versionMap[change.title.version];
	if (!page.changes[verindex]) {
		page.changes[verindex] = [];
	}
	page.changes[verindex].push(change.title.changed);
}

// Fetch all page information
const pageStatus: {
	[key: string]: string;
} = {};
const statusColors: {
	[key: string]: (s: string) => string;
} = {
	noExist: ch.redBright,
	noTarget: ch.yellow,
	noMeta: ch.red,
	toCreate: ch.blue,
	toUpdate: ch.cyan,
	upToDate: ch.green,
};

async function getAllPages() {
	let i = 0;
	let totalCount = Object.keys(pages).length;
	let promises: Promise<void>[] = [];

	function getPageCallback() {
		i++;
		process.stdout.write(ch.gray(`[INFO] Retreived Page ${i}/${totalCount}`));
		if (i < Object.keys(pages).length) {
			process.stdout.write("\r");
		}
	}

	for (const p in pages) {
		promises.push(getPage(p, getPageCallback));
	}

	for (const p of promises) {
		await p;
	}
}

async function getPage(p: string, callback: () => void) {
	const content = await bot.read(p);
	// Check if page exists
	if (content.missing) {
		pageStatus[p] = "noExist";
		callback();
		return;
	}
	const text = content.revisions![0].content!;
	if (!text.includes("<!--BEGIN HISTORY-->")) {
		if (!text.includes("{{NAW Changelist}}")) {
			pageStatus[p] = "noTarget";
			callback();
			return;
		}
		pageStatus[p] = "toCreate";
	} else {
		const regex = /<!--HISTORY META: (\w* *v\d+.\d+)-->/.exec(text);
		if (regex === null || regex[1] === undefined) {
			pageStatus[p] = "noMeta";
			callback();
			return;
		}
		const versionMeta = regex[1];
		if (versionMeta == latest.title.version) {
			pageStatus[p] = "upToDate";
			callback();
			return;
		}
		pageStatus[p] = "toUpdate";
	}
	callback();
}

console.log(ch.gray("[INFO] Retrieving Page Data..."));
await getAllPages();

// Page Overview Display Options
const MAX_PAGE_LENGTH = 26;
const COLUMNS = 3;

// Display an overview of every page and how many changes it has
console.log(
	ch.blueBright(
		"\n" +
			" ".repeat((COLUMNS * (MAX_PAGE_LENGTH + 4) - 26) / 2) +
			"-- PAGE CHANGE OVERVIEW --",
	),
);
console.log(
	ch.redBright("Does not exist ") +
		ch.yellow(" No Target ") +
		ch.red(" No Meta Tag ") +
		ch.blue(" Pending Creation ") +
		ch.cyan(" Pending Update ") +
		ch.green(" Up To Date"),
);

const pageSort = Object.keys(pages).sort();
let l = 0;
for (const page of pageSort) {
	let changes = 0;
	for (const version in pages[page].changes) {
		changes += pages[page].changes[version].length;
	}
	let pageName = page;
	if (pageName.length > MAX_PAGE_LENGTH) {
		pageName = pageName.substring(0, MAX_PAGE_LENGTH);
	}
	pageName = pageName.padEnd(MAX_PAGE_LENGTH + 2, " ");
	process.stdout.write(
		ch.magenta(changes.toString().padStart(2, " ")) +
			ch.gray(" - ") +
			statusColors[pageStatus[page]](pageName),
	);
	l++;
	if (l % COLUMNS == 0) {
		process.stdout.write("\n");
	}
}

if (l % COLUMNS != 0) {
	process.stdout.write("\n");
}

// Confirm prompt before making any changes to the wiki
if (
	!(await confirm({
		message: "Upload page changes to wiki?",
		default: false,
	}))
) {
	process.exit();
}

let pushCount = Object.keys(pages).filter(
	(p) => !["noExist", "noTarget", "noMeta", "upToDate"].includes(pageStatus[p]),
).length;
let i = 0;

// Begin making changes to the wiki
for (const p in pages) {
	const page = pages[p];
	// Check if page needs to be processed
	if (["noExist", "noTarget", "noMeta", "upToDate"].includes(pageStatus[p])) {
		continue;
	}
	i++;
	process.stdout.write(ch.magenta(`[INFO] Pushing ${i}/${pushCount}\r`));
	const content = await bot.read(p);
	// Check if page has a history section
	const text = content.revisions![0].content!;
	let outText: string = "";
	let before: string;
	let after: string;

	if (pageStatus[p] == "toCreate") {
		const split = text.split("{{NAW Changelist}}");
		before = split[0];
		after = split[1];
		before +=
			"== History ==\n" +
			"<!--\n" +
			"EDITOR NOTE:\n" +
			"Do NOT edit the follow history section as it is generated by a bot.\n" +
			"If there are any issues, please contact a wiki administrator on discord.\n" +
			"-->";
	} else {
		const split1 = text.split("<!--BEGIN HISTORY-->");
		before = split1[0];
		const split2 = split1[1].split("<!--END HISTORY-->");
		after = split2[1];
	}
	// Generate table wikitext
	outText +=
		"<!--BEGIN HISTORY-->" +
		"\n<!--HISTORY META: " +
		latest.title.version +
		"-->" +
		'\n{|class="wikitable" style="width:90%; margin:auto"|\n!colspan="2"|[[Nations at War]]';
	for (let v = 0; v < versionOrder.length; v++) {
		if (!Object.keys(page.changes).includes(v.toString())) {
			continue;
		}
		outText +=
			'\n|-\n|style="text-align:center;width:20%"|[[' +
			versionOrder[v].title.version +
			']]||style="width:80%"|\n' +
			page.changes[v].map((a) => "* " + a).join("\n");
	}
	outText += "\n|}\n" + "<!--END HISTORY-->";
	//console.log(ch.blue(`[INFO][${p}] Generated new history overview`));
	await bot.save(
		p,
		before + outText + after,
		"Update history to " + latest.title.version,
		{
			bot: true,
		},
	);
	console.log(ch.green(`[INFO][${p}] Pushed to wiki`));
}
