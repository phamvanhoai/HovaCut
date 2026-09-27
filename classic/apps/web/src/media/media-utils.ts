import type { MediaAsset, MediaType } from "@/media/types";

export const SUPPORTS_AUDIO: readonly MediaType[] = ["audio", "video"];

export function getMimeTypeFromName({ name }: { name: string }): string {
	const extension = name.split(".").pop()?.toLowerCase() ?? "";
	const mimeTypes: Record<string, string> = {
		mp4: "video/mp4",
		mov: "video/quicktime",
		mkv: "video/x-matroska",
		webm: "video/webm",
		avi: "video/x-msvideo",
		m4v: "video/x-m4v",
		mp3: "audio/mpeg",
		wav: "audio/wav",
		m4a: "audio/mp4",
		aac: "audio/aac",
		ogg: "audio/ogg",
		flac: "audio/flac",
		opus: "audio/opus",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		webp: "image/webp",
		gif: "image/gif",
		svg: "image/svg+xml",
	};
	return mimeTypes[extension] ?? "application/octet-stream";
}

export function mediaSupportsAudio({
	media,
}: {
	media: MediaAsset | null | undefined;
}): boolean {
	if (!media) return false;
	return SUPPORTS_AUDIO.includes(media.type);
}

export const getMediaTypeFromFile = ({
	file,
}: {
	file: File;
}): MediaType | null => {
	const { type } = file;

	if (type.startsWith("image/")) {
		return "image";
	}
	if (type.startsWith("video/")) {
		return "video";
	}
	if (type.startsWith("audio/")) {
		return "audio";
	}

	return null;
};
