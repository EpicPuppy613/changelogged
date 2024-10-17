import { Mwn } from "mwn";
import { readFileSync } from "fs";
import { confirm } from "@inquirer/prompts";
import { Chalk } from "chalk";
import page from "mwn/build/page.js";

const ch = new Chalk();

const FORCE_UPDATE = false;

// Read config file
let config: {
	username?: string;
	password?: string;
	wiki?: string;
	"max-page-length"?: number;
	"page-columns"?: number;
} = {};
try {
	config = JSON.parse(readFileSync("./config.json", "utf-8"));
} catch (e: any) {
	console.log(
		ch.red("[ERR] Config file does not exist! Please create a 'config.json'."),
	);
}

if (!config.username || !config.password || !config.wiki) {
	if (Object.keys(config).length > 0) {
		console.log(ch.red("[ERR] Config file is incomplete!"));
	}

	if (!config.username) {
		console.log(ch.yellow("[INFO] Config is missing value 'username'"));
	}
	if (!config.password) {
		console.log(ch.yellow("[INFO] Config is missing value 'password'"));
	}
	if (!config.wiki) {
		console.log(ch.yellow("[INFO] Config is missing value 'wiki'"));
	}

	process.exit(1);
}

console.log("[INFO] Using bot username: " + config.username);

// Initialize bot and connect to wiki
const bot = await Mwn.init({
	apiUrl: config.wiki,

	username: config.username,
	password: config.password,

	userAgent:
		"Changelogged v0.1 ([https://github.com/EpicPuppy613/changelogged])",

	retryPause: 4000,
	silent: true,
	suppressAPIWarnings: true,
	suppressInvalidDateWarning: true,
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
const latestIndex = versionOrder.length - 1;

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

interface PageMeta {
	status: string;
	pageVersion?: string;
}

let nameMap = {
	Alpha: "a",
	Beta: "b",
};

// Fetch all page information
const pageData: {
	[key: string]: PageMeta;
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
	const pageRequest = await bot.read(Object.keys(pages));

	for (const r of pageRequest) {
		let p = r.title;
		let content = r;
		// Check if page exists
		pageData[p] = { status: "noExist" };
		if (content.missing) {
			continue;
		}
		const text = content.revisions![0].content!;
		if (!text.includes("<!--BEGIN HISTORY-->")) {
			if (!text.includes("{{NAW Changelist}}")) {
				pageData[p] = { status: "noTarget" };
				continue;
			}
			pageData[p] = { status: "toCreate" };
		} else {
			const regex = /<!--HISTORY META: (\w* *v\d+.\d+)-->/.exec(text);
			if (regex === null || regex[1] === undefined) {
				pageData[p].status = "noMeta";
				continue;
			}
			const versionMeta = regex[1];
			pageData[p].pageVersion =
				/v(\d+.\d+)/.exec(versionMeta)![1] +
				(versionMeta.includes("Alpha") ? "a" : "b");
			// Manual update override
			if (FORCE_UPDATE) {
				pageData[p].status = "toUpdate";
				continue;
			}
			// Check if there have been any changes since that version
			pageData[p].status = "upToDate";
			const versionIndex = versionMap[versionMeta];
			for (const v of Object.keys(pages[p].changes)) {
				if (parseInt(v) > versionIndex) {
					pageData[p].status = "toUpdate";
					break;
				}
			}
		}
	}
}

console.log(ch.gray("[INFO] Retrieving Page Data..."));
await getAllPages();

// Page Overview Display Options
const MAX_PAGE_LENGTH = config["max-page-length"]
	? config["max-page-length"]
	: 24;
const COLUMNS = config["page-columns"] ? config["page-columns"] : 2;

// Display an overview of every page and how many changes it has
console.log(
	ch.blueBright.bold(
		" ".repeat((COLUMNS * (MAX_PAGE_LENGTH + 16) - 26) / 2) +
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
let columnOffset = Math.ceil(pageSort.length / COLUMNS);
for (let i = 0; i < pageSort.length; i++) {
	if (Math.floor(i / COLUMNS) + columnOffset * l >= pageSort.length) {
		continue;
	}
	let page = pageSort[Math.floor(i / COLUMNS) + columnOffset * l];
	let changes = 0;
	for (const version in pages[page].changes) {
		changes += pages[page].changes[version].length;
	}
	let pageName = page;
	if (pageName.length > MAX_PAGE_LENGTH) {
		pageName = pageName.substring(0, MAX_PAGE_LENGTH);
	}
	pageName = pageName.padEnd(MAX_PAGE_LENGTH + 1, " ");
	let versionName =
		(pageData[page].pageVersion ? pageData[page].pageVersion : "").padStart(
			6,
			" ",
		) + " ";
	process.stdout.write(
		ch.magenta(changes.toString().padStart(2, " ")) +
			ch.gray(" - ") +
			statusColors[pageData[page].status](pageName) +
			ch.gray(versionName),
	);
	l++;
	if (l % COLUMNS == 0) {
		process.stdout.write("\n");
		l = 0;
	}
}

if (l % COLUMNS != 0) {
	process.stdout.write("\n");
}

// If there are no pages to update, exit
if (
	Object.keys(pages).filter((p) =>
		["toCreate", "toUpdate"].includes(pageData[p].status),
	).length == 0
) {
	console.log(ch.greenBright("[INFO] No pages to update, exiting..."));
	process.exit();
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

async function pushAllPages() {
	let i = 0;
	let totalCount = Object.keys(pages).filter(
		(p) =>
			!["noExist", "noTarget", "noMeta", "upToDate"].includes(
				pageData[p].status,
			),
	).length;
	let promises: Promise<void>[] = [];

	function pushPageCallback() {
		i++;
		process.stdout.write(ch.gray(`[INFO] Pushed Page ${i}/${totalCount}`));
		if (i < Object.keys(pages).length) {
			process.stdout.write("\r");
		}
	}
	process.stdout.write(ch.gray(`[INFO] Pushed Page 0/${totalCount}\r`));

	let t = 0;
	for (const p in pages) {
		if (
			["noExist", "noTarget", "noMeta", "upToDate"].includes(pageData[p].status)
		) {
			continue;
		}
		promises.push(pushPage(p, t * 250, pushPageCallback));
		t++;
	}

	for (const p of promises) {
		await p;
	}
}

async function pushPage(p: string, offset: number, callback: () => void) {
	// Wait a bit to combat too many requests error
	await new Promise((r) => setTimeout(r, offset));
	const page = pages[p];
	const content = await bot.read(p);
	// Check if page has a history section
	const text = content.revisions![0].content!;
	let outText: string = "";
	let before: string;
	let after: string;

	if (pageData[p].status == "toCreate") {
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
	console.log(ch.green(`[INFO] Pushed ${ch.blueBright(p)} to wiki`));
	callback();
}

await pushAllPages();
