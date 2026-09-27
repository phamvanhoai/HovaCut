import path from "node:path";
import { writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { IMAGE_AUDIO_RESOLUTIONS, type ImageAudioResolution } from "@/automation/types";
import { getFfmpegStatus, runFfmpeg } from "@/automation/server/ffmpeg";
import { fileResponse, MAX_MEDIA_BYTES, saveUpload, withJobDirectory } from "@/automation/server/job-files";

export const runtime = "nodejs";
const MAX_BACKGROUNDS = 200;

function shuffle<T>(items: T[]) {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index--) {
		const target = Math.floor(Math.random() * (index + 1));
		[result[index], result[target]] = [result[target], result[index]];
	}
	return result;
}

export async function POST(request: Request) {
	const status = await getFfmpegStatus();
	if (!status.available) return NextResponse.json({ error: status.error }, { status: 503 });
	const form = await request.formData();
	const audio = form.get("audio");
	const backgrounds = form.getAll("backgrounds").filter((value): value is File => value instanceof File && (value.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(value.name)));
	if (!(audio instanceof File)) return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
	if (backgrounds.length === 0) return NextResponse.json({ error: "Select at least one background video." }, { status: 400 });
	if (backgrounds.length > MAX_BACKGROUNDS) return NextResponse.json({ error: `A maximum of ${MAX_BACKGROUNDS} backgrounds is allowed.` }, { status: 400 });
	if (audio.size > MAX_MEDIA_BYTES || backgrounds.some((file) => file.size > MAX_MEDIA_BYTES)) return NextResponse.json({ error: "Each media file must be 500 MB or smaller." }, { status: 400 });

	const resolution: ImageAudioResolution = form.get("resolution") === "4k" ? "4k" : "1080p";
	const { width, height } = IMAGE_AUDIO_RESOLUTIONS[resolution];
	const randomizedBackgrounds = shuffle(backgrounds);

	try {
		return await withJobDirectory({ prefix: "hovacut-auto-video-", run: async (directory) => {
			const [audioPath, backgroundPaths] = await Promise.all([
				saveUpload({ file: audio, directory, index: 0 }),
				Promise.all(randomizedBackgrounds.map((file, index) => saveUpload({ file, directory, index: index + 1 }))),
			]);
			const concatPath = path.join(directory, "backgrounds.txt");
			const concatList = backgroundPaths.map((filePath) => `file '${filePath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
			await writeFile(concatPath, concatList, "utf8");
			const output = path.join(directory, "auto-video.mp4");
			const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
			await runFfmpeg({ args: [
				"-y",
				"-stream_loop", "-1",
				"-f", "concat",
				"-safe", "0",
				"-i", concatPath,
				"-i", audioPath,
				"-map", "0:v:0",
				"-map", "1:a:0",
				"-vf", filter,
				"-c:v", "libx264",
				"-preset", "medium",
				"-c:a", "aac",
				"-b:a", "192k",
				"-shortest",
				"-fflags", "+shortest",
				"-max_interleave_delta", "100M",
				"-movflags", "+faststart",
				output,
			] });
			return fileResponse({ path: output, contentType: "video/mp4", filename: "hovacut-auto-video.mp4" });
		} });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Auto video render failed." }, { status: 500 });
	}
}
