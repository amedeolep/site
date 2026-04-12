import type { APIRoute } from "astro";

export const prerender = false;

const ROME_TIME_ZONE = "Europe/Rome";
const DEFAULT_SAINT = "Saint N.";

type DailyPayload = {
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

export const GET: APIRoute = async () => {
	const today = new Date();
	const romeDate = getRomeDateParts(today);

	const fallback: DailyPayload = {
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

	try {
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

		const payload: DailyPayload = {
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

		return jsonResponse(payload, 200, {
			"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=43200",
		});
	} catch (error) {
		return jsonResponse(
			{
				...fallback,
				debug: error instanceof Error ? error.message : "Unknown daily feed error",
			},
			200,
			{
				"Cache-Control": "no-store",
			},
		);
	}
};

async function fetchText(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			"user-agent": "Mozilla/5.0 MorningPrayerPage/1.0",
			accept: "text/html,application/xhtml+xml",
		},
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status}`);
	}

	return await response.text();
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

	const cleanedLines = rawLines.filter((line) => shouldKeepPsalmLine(line, raw_refrain));
	const proseStream = cleanedLines.join(" ").replace(/\s+/g, " ").trim();

	const sentenceUnits = splitIntoSentenceUnits(proseStream);
	const verses = sentenceUnits
		.flatMap((unit) => splitOverlongUnit(unit))
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

function splitIntoSentenceUnits(text: string) {
	const units: string[] = [];
	let current = "";

	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		current += char;

		if (/[.!?;:]/.test(char)) {
			const trimmed = normalizeWhitespace(current);
			if (trimmed) units.push(trimmed);
			current = "";
			continue;
		}

		if (char === '"' || char === "”") {
			const nextNonSpace = text.slice(i + 1).match(/\S/)?.[0] || "";
			if (/[A-Z(“"]/.test(nextNonSpace)) {
				const trimmed = normalizeWhitespace(current);
				if (trimmed) units.push(trimmed);
				current = "";
			}
		}
	}

	const tail = normalizeWhitespace(current);
	if (tail) units.push(tail);

	return units;
}

function splitOverlongUnit(unit: string): string[] {
	const wordCount = countWords(unit);
	if (wordCount <= 14) return [unit];

	const splitPoints = findSplitPoints(unit, [
		",",
		"—",
		" – ",
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
	]);

	if (!splitPoints.length) return [unit];

	const midpoint = Math.floor(unit.length / 2);
	const best = splitPoints.reduce((closest, current) => {
		return Math.abs(current - midpoint) < Math.abs(closest - midpoint) ? current : closest;
	}, splitPoints[0]);

	const left = normalizeWhitespace(unit.slice(0, best + 1));
	const right = normalizeWhitespace(unit.slice(best + 1));

	if (!left || !right) return [unit];

	const result: string[] = [];

	if (countWords(left) > 14) {
		result.push(...splitOverlongUnit(left));
	} else {
		result.push(left);
	}

	if (countWords(right) > 14) {
		result.push(...splitOverlongUnit(right));
	} else {
		result.push(right);
	}

	return result;
}

function unitToChantVerse(unit: string) {
	const cleaned = normalizeWhitespace(unit);
	if (!cleaned) return "";

	const splitIndex = chooseVerseSplit(cleaned);
	const left = normalizeWhitespace(cleaned.slice(0, splitIndex));
	const right = normalizeWhitespace(cleaned.slice(splitIndex));

	if (!left || !right) {
		return splitByWordMidpoint(cleaned);
	}

	return `${left} * ${right}`;
}

function chooseVerseSplit(text: string) {
	const candidates = [
		...findBoundaryCandidates(text, [",", ";", ":", "—", " – "], 4),
		...findBoundaryCandidates(
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
			],
			3,
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

function findBoundaryCandidates(text: string, markers: string[], minWordsPerSide: number) {
	const candidates: number[] = [];

	for (const marker of markers) {
		let startIndex = 0;

		while (startIndex < text.length) {
			const index = text.indexOf(marker, startIndex);
			if (index === -1) break;

			const splitAfter = marker.trim().length === 1 ? index + 1 : index + marker.length / 2;
			const left = normalizeWhitespace(text.slice(0, Math.floor(splitAfter)));
			const right = normalizeWhitespace(text.slice(Math.floor(splitAfter)));

			if (countWords(left) >= minWordsPerSide && countWords(right) >= minWordsPerSide) {
				candidates.push(Math.floor(splitAfter));
			}

			startIndex = index + Math.max(1, marker.length);
		}
	}

	return candidates;
}

function findSplitPoints(text: string, markers: string[]) {
	const points: number[] = [];

	for (const marker of markers) {
		let startIndex = 0;

		while (startIndex < text.length) {
			const index = text.indexOf(marker, startIndex);
			if (index === -1) break;

			points.push(index + Math.max(0, marker.length - 1));
			startIndex = index + Math.max(1, marker.length);
		}
	}

	return points;
}

function splitByWordMidpoint(text: string) {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length < 2) return text;

	const middle = Math.max(1, Math.floor(words.length / 2));
	return `${words.slice(0, middle).join(" ")} * ${words.slice(middle).join(" ")}`;
}

function findNearestWordBoundary(text: string, target: number) {
	let best = target;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let i = 1; i < text.length - 1; i += 1) {
		if (text[i] === " ") {
			const distance = Math.abs(i - target);
			if (distance < bestDistance) {
				best = i;
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
			.replace(/^\(\d+\)\s*/, "")
			.replace(/^\d+\.\s*/, ""),
	);
}

function normalizeWhitespace(value: string) {
	return value.replace(/[ \t]+/g, " ").trim();
}

function normalizeComparison(value: string) {
	return normalizeWhitespace(value)
		.toLowerCase()
		.replace(/[“”"‘’']/g, "")
		.replace(/[.,;:!?]/g, "");
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

function jsonResponse(
	data: unknown,
	status = 200,
	headers: Record<string, string> = {},
) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...headers,
		},
	});
}