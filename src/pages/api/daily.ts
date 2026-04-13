import type { APIRoute } from "astro";
import { getDailyPayload, getFallbackDailyPayload } from "../../lib/daily";

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const payload = await getDailyPayload();

		return new Response(JSON.stringify(payload, null, 2), {
			status: 200,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=43200",
			},
		});
	} catch (error) {
		const fallback = {
			...getFallbackDailyPayload(),
			debug: error instanceof Error ? error.message : "Unknown daily feed error",
		};

		return new Response(JSON.stringify(fallback, null, 2), {
			status: 200,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	}
};