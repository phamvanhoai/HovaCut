import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { IMAGE_AUDIO_RESOLUTIONS, type ImageAudioResolution } from "@/automation/types";
import { getFfmpegStatus, runFfmpeg } from "@/automation/server/ffmpeg";

export const runtime = "nodejs";

const IMAGE_TYPES = new Map([
	["image/jpeg", ".jpg"],
	["image/png", ".png"],
	["image/webp", ".webp"],
	["image/bmp", ".bmp"],
]);
const AUDIO_TYPES = new Map([
	["audio/mpeg", ".mp3"],
	["audio/wav", ".wav"],
	["audio/x-wav", ".wav"],
	["audio/mp4", ".m4a"],
	["audio/aac", ".aac"],
	["audio/ogg", ".ogg"],
	["audio/flac", ".flac"],
]);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

function errorResponse({ message, status = 400 }: { message: string; status?: number }) {
	return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
	const status = await getFfmpegStatus();
	if (!status.available) return errorResponse({ message: status.error ?? "FFmpeg is unavailable.", status: 503 });

	const form = await request.formData();
	const image = form.get("image");
	const audio = form.get("audio");
	const resolutionValue = form.get("resolution");
	if (!(image instanceof File) || !(audio instanceof File)) return errorResponse({ message: "Image and audio files are required." });
	if (image.size > MAX_IMAGE_BYTES) return errorResponse({ message: "Image must be 25 MB or smaller." });
	if (audio.size > MAX_AUDIO_BYTES) return errorResponse({ message: "Audio must be 500 MB or smaller." });

	const imageExtension = IMAGE_TYPES.get(image.type);
	const audioExtension = AUDIO_TYPES.get(audio.type);
	if (!imageExtension) return errorResponse({ message: `Unsupported image type: ${image.type || "unknown"}.` });
	if (!audioExtension) return errorResponse({ message: `Unsupported audio type: ${audio.type || "unknown"}.` });

	const resolution: ImageAudioResolution = resolutionValue === "4k" ? "4k" : "1080p";
	const { width, height } = IMAGE_AUDIO_RESOLUTIONS[resolution];
	const jobDirectory = await mkdtemp(path.join(os.tmpdir(), "hovacut-image-audio-"));
	const imagePath = path.join(jobDirectory, `image${imageExtension}`);
	const audioPath = path.join(jobDirectory, `audio${audioExtension}`);
	const outputPath = path.join(jobDirectory, "output.mp4");

	try {
		await Promise.all([
			writeFile(imagePath, Buffer.from(await image.arrayBuffer())),
			writeFile(audioPath, Buffer.from(await audio.arrayBuffer())),
		]);
		const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
		await runFfmpeg({
			args: [
				"-y",
				"-framerate", "25",
				"-loop", "1",
				"-i", imagePath,
				"-i", audioPath,
				"-vf", videoFilter,
				"-c:v", "libx264",
				"-preset", "medium",
				"-tune", "stillimage",
				"-c:a", "aac",
				"-b:a", "192k",
				"-shortest",
				"-fflags", "+shortest",
				"-max_interleave_delta", "100M",
				"-movflags", "+faststart",
				outputPath,
			],
		});
		const output = await readFile(outputPath);
		return new Response(output, {
			headers: {
				"Content-Type": "video/mp4",
				"Content-Disposition": 'attachment; filename="hovacut-image-audio.mp4"',
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		return errorResponse({ message: error instanceof Error ? error.message : "Render failed.", status: 500 });
	} finally {
		await rm(jobDirectory, { recursive: true, force: true });
	}
}
