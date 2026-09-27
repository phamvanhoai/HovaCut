import path from "node:path";
import { NextResponse } from "next/server";
import { getFfmpegStatus, runFfmpeg } from "@/automation/server/ffmpeg";
import { fileResponse, MAX_MEDIA_BYTES, saveUpload, withJobDirectory } from "@/automation/server/job-files";

export const runtime = "nodejs";
const MAX_FILES = 50;

function shuffle<T>(items: T[]) {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index--) {
		const swap = Math.floor(Math.random() * (index + 1));
		[result[index], result[swap]] = [result[swap], result[index]];
	}
	return result;
}

export async function POST(request: Request) {
	const status = await getFfmpegStatus();
	if (!status.available) return NextResponse.json({ error: status.error }, { status: 503 });
	const form = await request.formData();
	let files = form.getAll("files").filter((value): value is File => value instanceof File);
	if (files.length < 2) return NextResponse.json({ error: "Select at least two audio files." }, { status: 400 });
	if (files.length > MAX_FILES) return NextResponse.json({ error: `A maximum of ${MAX_FILES} files is allowed.` }, { status: 400 });
	if (files.some((file) => file.size > MAX_MEDIA_BYTES)) return NextResponse.json({ error: "Each audio file must be 500 MB or smaller." }, { status: 400 });
	if (form.get("random") === "true") files = shuffle(files);

	try {
		return await withJobDirectory({ prefix: "hovacut-join-audio-", run: async (directory) => {
			const inputs = await Promise.all(files.map((file, index) => saveUpload({ file, directory, index })));
			const output = path.join(directory, "playlist.mp3");
			const inputArgs = inputs.flatMap((input) => ["-i", input]);
			const labels = inputs.map((_, index) => `[${index}:a:0]`).join("");
			const filter = `${labels}concat=n=${inputs.length}:v=0:a=1[outa]`;
			await runFfmpeg({ args: ["-y", ...inputArgs, "-filter_complex", filter, "-map", "[outa]", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", output] });
			return fileResponse({ path: output, contentType: "audio/mpeg", filename: "hovacut-playlist.mp3" });
		} });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Joining audio failed." }, { status: 500 });
	}
}
