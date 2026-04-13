export type DailyPayload = {
	dateLabel: string;
	saintOfTheDay: string;
	psalm: {
		reference: string;
		raw_refrain: string;
		verses: string[];
		display_text: string;
		mode: "mass-fallback" | "placeholder";
	};
	gospel: {
		reference: string;
		text: string;
	};
};

const ROME_TIME_ZONE = "Europe/Rome";
const DEFAULT_SAINT = "Saint N.";

export function getFallbackDailyPayload(date = new Date()): DailyPayload {
	const romeDate = getRomeDateParts(date);

	return {
		dateLabel: romeDate.longLabel,
		saintOfTheDay: DEFAULT_SAINT,
		psalm: {
			reference: "Psalm of the day",
			raw_refrain: "",
			verses: [],
			display_text: "Psalm unavailable right now.",
			mode: "placeholder",
		},
		gospel: {
			reference: "Gospel of the day",
			text: "Gospel unavailable right now.",
		},
	};
}

export async function getDailyPayload(date = new Date()): Promise<DailyPayload> {
	const romeDate = getRomeDateParts(date);

	const fallback = getFallbackDailyPayload(date);

	const usccbUrl = `https://bible.usccb.org/bible/readings/${romeDate.mm}${romeDate.dd}${romeDate.yyShort}.cfm`;
	const saintUrl = `https://www.vaticannews.va/en/saints/${romeDate.mm}/${romeDate.dd}.html`;

	const [usccbResult, saintResult] = await Promise.allSettled([
		fetchText(usccbUrl),
		fetchText(saintUrl),
	]);

	let saintOfTheDay = DEFAULT_SAINT;
	if (saintResult.status === "fulfilled") {
		const parsedSaint = parseSaintOfTheDay(saintResult.value);
		if (parsedSaint) saintOfTheDay = parsedSaint;
	}

	let gospelReference = fallback.gospel.reference;
	let gospelText = fallback.gospel.text;
	let psalmReference = fallback.psalm.reference;
	let psalmRawText = "";

	if (usccbResult.status === "fulfilled") {
		const readings = parseUsccbDaily(usccbResult.value);

		if (readings.gospel.reference) gospelReference = readings.gospel.reference;
		if (readings.gospel.text) gospelText = readings.gospel.text;
		if (readings.psalm.reference) psalmReference = readings.psalm.reference;
		if (readings.psalm.text) psalmRawText = readings.psalm.text;
	}

	const processedPsalm = psalmRawText
		? processResponsorialPsalm(psalmRawText)
		: {
				raw_refrain: "",
				verses: [],
				display_text: "Psalm unavailable right now.",
			};

	return {
		dateLabel: romeDate.longLabel,
		saintOfTheDay,
		psalm: {
			reference: psalmReference,
			raw_refrain: processedPsalm.raw_refrain,
			verses: processedPsalm.verses,
			display_text: processedPsalm.display_text,
			mode: psalmRawText ? "mass-fallback" : "placeholder",
		},
		gospel: {
			reference: gospelReference,
			text: gospelText,
		},
	};
}

async function fetchText(url: string): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 12000);

	try {
		const response = await fetch(url, {
			headers: {
				"user-agent": "Mozilla/5.0 MorningPrayerPage/1.0",
				accept: "text/html,application/xhtml+xml",
			},
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status}`);
		}

		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

function getRomeDateParts(date: Date) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: ROME_TIME_ZONE,
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		weekday: "long",
	}).formatToParts(date);

	const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	const year = map.year;
	const month = map.month;
	const day = map.day;
	const weekday = map.weekday;

	return {
		dd: day,
		mm: month,
		yyShort: year.slice(-2),
		longLabel: `${weekday}, ${Number(day)} ${monthName(month)} ${year}`,
	};
}

function monthName(month: string) {
	return [
		"",
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	][Number(month)];
}

function parseUsccbDaily(html: string) {
	const lines = htmlToLines(html);

	const gospelIndex = findHeadingIndex(lines, ["Gospel"]);
	const gospelReference =
		gospelIndex >= 0 ? lines[gospelIndex + 1] || "Gospel of the day" : "Gospel of the day";
	const gospelText =
		gospelIndex >= 0
			? collectUntil(lines, gospelIndex + 2, (line) => {
					return (
						line === "LISTEN PODCAST" ||
						line === "VIEW REFLECTION VIDEO" ||
						line === "En Español" ||
						line === "View Calendar" ||
						line === "Get Daily Readings E-mails" ||
						line === "Get the Daily Readings" ||
						line === "Dive into God's Word" ||
						line.startsWith("Readings for the ") ||
						line.startsWith("Lectionary for Mass")
					);
				})
			: "";

	const psalmIndex = findHeadingIndex(lines, ["Responsorial Psalm"]);
	const psalmReference =
		psalmIndex >= 0 ? lines[psalmIndex + 1] || "Responsorial Psalm" : "Responsorial Psalm";
	const psalmText =
		psalmIndex >= 0
			? collectUntil(lines, psalmIndex + 2, (line) => {
					return (
						/^Reading \d+$/i.test(line) ||
						line === "Alleluia" ||
						line === "Gospel" ||
						line === "LISTEN PODCAST" ||
						line === "VIEW REFLECTION VIDEO"
					);
				})
			: "";

	return {
		gospel: {
			reference: gospelReference,
			text: gospelText,
		},
		psalm: {
			reference: psalmReference,
			text: psalmText,
		},
	};
}

function parseSaintOfTheDay(html: string) {
	const lines = htmlToLines(html);
	const start = findHeadingIndex(lines, ["Saint of the day"]);

	if (start < 0) return "";

	const candidates = lines.slice(start + 1, start + 80).filter((line) => {
		return /^(St\.|Sts\.|Saint |Blessed |Bl\.)/.test(line);
	});

	return cleanSaintName(candidates[0] || "");
}

function cleanSaintName(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function findHeadingIndex(lines: string[], targets: string[]) {
	return lines.findIndex((line) => targets.includes(line.trim()));
}

function collectUntil(
	lines: string[],
	startIndex: number,
	shouldStop: (line: string) => boolean,
) {
	const collected: string[] = [];

	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index];
		if (shouldStop(line)) break;
		if (!line) continue;
		collected.push(line);
	}

	return collected.join("\n");
}

function processResponsorialPsalm(rawText: string) {
	const rawLines = rawText
		.split(/\n+/)
		.map((line) => normalizeWhitespace(line))
		.filter(Boolean);

	const rawRefrainLine =
		rawLines.find((line) => /^R\./i.test(line) && !/alleluia/i.test(line)) ||
		rawLines.find((line) => /^R\./i.test(line)) ||
		"";

	const raw_refrain = stripRefrainLine(rawRefrainLine);

	const cleanedLines = rawLines
		.filter((line) => shouldKeepPsalmLine(line, raw_refrain))
		.map((line) => trimOuterQuotes(line))
		.filter(Boolean);

	const proseStream = cleanedLines.join(" ").replace(/\s+/g, " ").trim();

	const clauseUnits = splitIntoClauseUnits(proseStream)
		.map((unit) => trimOuterQuotes(unit))
		.filter(Boolean);

	const verses = clauseUnits
		.flatMap((unit) => aggressivelyShortenUnit(unit))
		.map((unit) => unitToChantVerse(unit))
		.filter(Boolean);

	return {
		raw_refrain,
		verses,
		display_text: verses.length ? verses.join("\n") : "Psalm unavailable right now.",
	};
}

function shouldKeepPsalmLine(line: string, rawRefrain: string) {
	if (!line) return false;
	if (/^R\./i.test(line)) return false;
	if (/^\(?\d+\)?\s*R\./i.test(line)) return false;
	if (/^or:?$/i.test(line)) return false;
	if (/^Alleluia[.!]?$/i.test(line)) return false;
	if (/^R\.\s*Alleluia[.!]?$/i.test(line)) return false;

	const normalizedLine = normalizeComparison(line);
	const normalizedRefrain = normalizeComparison(rawRefrain);

	if (normalizedRefrain && normalizedLine === normalizedRefrain) return false;

	return true;
}

function splitIntoClauseUnits(text: string) {
	const units: string[] = [];
	let current = "";

	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		current += char;

		if (/[.!?;:]/.test(char)) {
			pushUnit(current, units);
			current = "";
			continue;
		}

		if (char === ",") {
			const leftWords = countWords(current);
			const rightPreview = text.slice(i + 1, i + 80);
			const rightWords = countWords(rightPreview);
			if (leftWords >= 4 && rightWords >= 4) {
				pushUnit(current, units);
				current = "";
			}
		}
	}

	pushUnit(current, units);

	return units;
}

function pushUnit(value: string, units: string[]) {
	const cleaned = trimOuterQuotes(normalizeWhitespace(value));
	if (cleaned && cleaned !== `"` && cleaned !== `“` && cleaned !== `”`) {
		units.push(cleaned);
	}
}

function aggressivelyShortenUnit(unit: string): string[] {
	const cleaned = normalizeWhitespace(unit);
	if (!cleaned) return [];

	if (countWords(cleaned) <= 10) return [cleaned];

	const splitIndex = chooseHardSplit(cleaned);
	if (splitIndex < 0) return [cleaned];

	const left = normalizeWhitespace(cleaned.slice(0, splitIndex));
	const right = normalizeWhitespace(cleaned.slice(splitIndex));

	if (!left || !right) return [cleaned];

	return [
		...aggressivelyShortenUnit(left),
		...aggressivelyShortenUnit(right),
	];
}

function chooseHardSplit(text: string) {
	const candidates = [
		...findDelimiterSplitCandidates(text, [":", ";", "?", "!", ","], 3),
		...findWordSplitCandidates(
			text,
			[
				" and ",
				" but ",
				" for ",
				" that ",
				" who ",
				" which ",
				" to ",
				" from ",
				" with ",
				" upon ",
				" before ",
				" into ",
				" against ",
				" in ",
				" on ",
				" of ",
			],
			3,
		),
	];

	if (!candidates.length) return -1;

	const midpoint = Math.floor(text.length / 2);

	return candidates.reduce((best, current) => {
		return Math.abs(current - midpoint) < Math.abs(best - midpoint) ? current : best;
	}, candidates[0]);
}

function findDelimiterSplitCandidates(
	text: string,
	delimiters: string[],
	minWordsPerSide: number,
) {
	const candidates: number[] = [];

	for (const delimiter of delimiters) {
		let startIndex = 0;

		while (startIndex < text.length) {
			const index = text.indexOf(delimiter, startIndex);
			if (index === -1) break;

			const splitIndex = findNextSpace(text, index + delimiter.length);
			if (splitIndex > 0) {
				const left = normalizeWhitespace(text.slice(0, splitIndex));
				const right = normalizeWhitespace(text.slice(splitIndex));

				if (countWords(left) >= minWordsPerSide && countWords(right) >= minWordsPerSide) {
					candidates.push(splitIndex);
				}
			}

			startIndex = index + delimiter.length;
		}
	}

	return candidates;
}

function findWordSplitCandidates(
	text: string,
	markers: string[],
	minWordsPerSide: number,
) {
	const candidates: number[] = [];

	for (const marker of markers) {
		let startIndex = 0;

		while (startIndex < text.length) {
			const index = text.indexOf(marker, startIndex);
			if (index === -1) break;

			const splitIndex = index + marker.length;
			const left = normalizeWhitespace(text.slice(0, splitIndex));
			const right = normalizeWhitespace(text.slice(splitIndex));

			if (countWords(left) >= minWordsPerSide && countWords(right) >= minWordsPerSide) {
				candidates.push(splitIndex);
			}

			startIndex = index + marker.length;
		}
	}

	return candidates;
}

function findNextSpace(text: string, fromIndex: number) {
	for (let i = fromIndex; i < text.length; i += 1) {
		if (text[i] === " ") return i + 1;
	}
	return -1;
}

function unitToChantVerse(unit: string) {
	const cleaned = trimOuterQuotes(normalizeWhitespace(unit));
	if (!cleaned) return "";

	const splitIndex = chooseVerseSplit(cleaned);
	if (splitIndex < 0) return splitByWordMidpoint(cleaned);

	const left = normalizeWhitespace(cleaned.slice(0, splitIndex));
	const right = normalizeWhitespace(cleaned.slice(splitIndex));

	if (!left || !right) return splitByWordMidpoint(cleaned);

	return `${left} * ${right}`;
}

function chooseVerseSplit(text: string) {
	const candidates = [
		...findDelimiterSplitCandidates(text, [":", ";", ","], 2),
		...findWordSplitCandidates(
			text,
			[
				" and ",
				" but ",
				" for ",
				" that ",
				" who ",
				" which ",
				" to ",
				" from ",
				" with ",
				" upon ",
				" before ",
				" into ",
				" against ",
				" in ",
				" on ",
				" of ",
			],
			2,
		),
	];

	if (!candidates.length) {
		return findNearestWordBoundary(text, Math.floor(text.length / 2));
	}

	const midpoint = Math.floor(text.length / 2);

	return candidates.reduce((best, current) => {
		return Math.abs(current - midpoint) < Math.abs(best - midpoint) ? current : best;
	}, candidates[0]);
}

function splitByWordMidpoint(text: string) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length < 2) return text;

	const middle = Math.max(1, Math.floor(words.length / 2));
	return `${words.slice(0, middle).join(" ")} * ${words.slice(middle).join(" ")}`;
}

function findNearestWordBoundary(text: string, target: number) {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let i = 1; i < text.length - 1; i += 1) {
		if (text[i] === " ") {
			const distance = Math.abs(i + 1 - target);
			if (distance < bestDistance) {
				best = i + 1;
				bestDistance = distance;
			}
		}
	}

	return best;
}

function stripRefrainLine(line: string) {
	return normalizeWhitespace(
		line
			.replace(/^R\.\s*/i, "")
			.replace(/^\(\d+[a-z]?\)\s*/i, "")
			.replace(/^\(see\s+[^\)]+\)\s*/i, "")
			.replace(/^\d+\.\s*/, ""),
	);
}

function trimOuterQuotes(value: string) {
	return normalizeWhitespace(
		value
			.replace(/^[“"]+\s*/, "")
			.replace(/\s*[”"]+$/, ""),
	);
}

function normalizeWhitespace(value: string) {
	return value.replace(/[ \t]+/g, " ").trim();
}

function normalizeComparison(value: string) {
	return normalizeWhitespace(value)
		.toLowerCase()
		.replace(/[“”"‘’']/g, "")
		.replace(/[.,;:!?()]/g, "");
}

function countWords(value: string) {
	return normalizeWhitespace(value).split(/\s+/).filter(Boolean).length;
}

function htmlToLines(html: string) {
	const withoutScripts = html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

	const withBreaks = withoutScripts
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(
			/<\/(p|div|section|article|header|footer|aside|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|td|blockquote)>/gi,
			"\n",
		)
		.replace(
			/<(p|div|section|article|header|footer|aside|li|ul|ol|h1|h2|h3|h4|h5|h6|tr|td|blockquote)[^>]*>/gi,
			"\n",
		);

	const textOnly = withBreaks.replace(/<[^>]+>/g, " ");
	const decoded = decodeHtmlEntities(textOnly);

	return decoded
		.split(/\n+/)
		.map((line) => line.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}

function decodeHtmlEntities(text: string) {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		ldquo: "“",
		rdquo: "”",
		lsquo: "‘",
		rsquo: "’",
		ndash: "–",
		mdash: "—",
		hellip: "…",
	};

	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			return String.fromCodePoint(parseInt(entity.slice(2), 16));
		}
		if (entity.startsWith("#")) {
			return String.fromCodePoint(parseInt(entity.slice(1), 10));
		}
		return named[entity] ?? `&${entity};`;
	});
}