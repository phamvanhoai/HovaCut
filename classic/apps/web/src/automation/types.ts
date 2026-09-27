export const IMAGE_AUDIO_RESOLUTIONS = {
	"1080p": { width: 1920, height: 1080 },
	"4k": { width: 3840, height: 2160 },
} as const;

export type ImageAudioResolution = keyof typeof IMAGE_AUDIO_RESOLUTIONS;

export type FfmpegStatus = {
	enabled: boolean;
	available: boolean;
	path: string | null;
	version: string | null;
	error?: string;
};
