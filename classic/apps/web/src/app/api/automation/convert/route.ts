import path from "node:path";
import { NextResponse } from "next/server";
import { getFfmpegStatus, runFfmpeg } from "@/automation/server/ffmpeg";
import { fileResponse, MAX_MEDIA_BYTES, saveUpload, withJobDirectory } from "@/automation/server/job-files";

export const runtime = "nodejs";

const FORMATS = {
	mp3: { extension: ".mp3", contentType: "audio/mpeg", args: ["-vn", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k"] },
	wav: { extension: ".wav", contentType: "audio/wav", args: ["-vn", "-c:a", "pcm_s16le", "-ar", "44100"] },
	mp4: { extension: ".mp4", contentType: "video/mp4", args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"] },
} as const;

export async function POST(request: Request) {
	const status = await getFfmpegStatus();
	if (!status.available) return NextResponse.json({ error: status.error }, { status: 503 });
	const form = await request.formData();
	const file = form.get("file");
	const formatValue = form.get("format");
	if (!(file instanceof File)) return NextResponse.json({ error: "Media file is required." }, { status: 400 });
	if (file.size > MAX_MEDIA_BYTES) return NextResponse.json({ error: "Media must be 500 MB or smaller." }, { status: 400 });
	const format = formatValue === "wav" ? "wav" : formatValue === "mp4" ? "mp4" : "mp3";
	const config = FORMATS[format];

	try {
		return await withJobDirectory({ prefix: "hovacut-convert-", run: async (directory) => {
			const input = await saveUpload({ file, directory });
			const output = path.join(directory, `output${config.extension}`);
			await runFfmpeg({ args: ["-y", "-i", input, ...config.args, output] });
			return fileResponse({ path: output, contentType: config.contentType, filename: `hovacut-converted${config.extension}` });
		} });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Conversion failed." }, { status: 500 });
	}
}
