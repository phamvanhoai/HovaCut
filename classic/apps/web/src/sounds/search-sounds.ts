import type { SoundEffect } from "@/sounds/types";

export interface SoundSearchResponse {
	count: number;
	next: string | null;
	previous: string | null;
	results: SoundEffect[];
	query: string;
	type: string;
	page: number;
	pageSize: number;
	sort: string;
	minRating: number;
}

export async function searchSounds({
	query,
	page = 1,
	pageSize = 20,
	sort = "downloads",
	commercialOnly = true,
}: {
	query?: string;
	page?: number;
	pageSize?: number;
	sort?: "downloads" | "rating" | "created" | "score";
	commercialOnly?: boolean;
}): Promise<SoundSearchResponse> {
	if (typeof window !== "undefined" && window.__TAURI__) {
		return window.__TAURI__.core.invoke<SoundSearchResponse>("search_sounds", {
			query: query || null,
			page,
			pageSize,
			sort,
			minRating: 3,
			commercialOnly,
		});
	}

	const params = new URLSearchParams({
		page: page.toString(),
		page_size: pageSize.toString(),
		sort,
		type: "effects",
		commercial_only: commercialOnly.toString(),
	});
	if (query?.trim()) params.set("q", query.trim());
	const response = await fetch(`/api/sounds/search?${params.toString()}`);
	if (!response.ok) throw new Error(`Sound search failed: ${response.status}`);
	return response.json() as Promise<SoundSearchResponse>;
}
