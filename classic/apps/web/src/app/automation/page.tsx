"use client";

import {
	useEffect,
	useRef,
	useState,
	type FormEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	CheckCircle2,
	ChevronsUp,
	CircleAlert,
	Clapperboard,
	Download,
	FileCog,
	FileText,
	ImageIcon,
	Images,
	ListMusic,
	LoaderCircle,
	Music2,
	Pin,
	PinOff,
	Shuffle,
	Trash2,
	WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FfmpegStatus } from "@/automation/types";

type CompletedJob = {
	id: string;
	filename: string;
	url: string;
	createdAt: Date;
};
type DesktopAudio = {
	path: string;
	name: string;
	size: number;
	lastModified: number;
};
type ToolId =
	| "auto-video"
	| "auto-mp3"
	| "image-audio"
	| "convert"
	| "join-audio"
	| "video-frames"
	| "join-video"
	| "lofi-video"
	| "text-list";
type TauriApi = {
	core: {
		invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
		convertFileSrc: (path: string) => string;
	};
	dialog: {
		open: (
			options: Record<string, unknown>,
		) => Promise<string | string[] | null>;
		save: (options: Record<string, unknown>) => Promise<string | null>;
	};
	event: {
		listen: <T>(
			event: string,
			handler: (event: { payload: T }) => void,
		) => Promise<() => void>;
	};
};

declare global {
	interface Window {
		__TAURI__?: TauriApi;
	}
}

const TOOLS = [
	{
		id: "auto-video" as const,
		label: "Auto Video",
		description: "Random từ thư mục",
		icon: Clapperboard,
	},
	{
		id: "auto-mp3" as const,
		label: "Auto MP3",
		description: "Tạo playlist hàng loạt",
		icon: Music2,
	},
	{
		id: "image-audio" as const,
		label: "Ảnh + Audio",
		description: "Tạo video MP4",
		icon: ImageIcon,
	},
	{
		id: "convert" as const,
		label: "Convert Media",
		description: "Đổi định dạng",
		icon: FileCog,
	},
	{
		id: "join-audio" as const,
		label: "Ghép / Random MP3",
		description: "Tạo playlist",
		icon: ListMusic,
	},
	{
		id: "video-frames" as const,
		label: "Video → Ảnh",
		description: "Trích khung hình",
		icon: Images,
	},
	{
		id: "join-video" as const,
		label: "Ghép / Random Video",
		description: "Nối nhiều video",
		icon: Clapperboard,
	},
	{
		id: "lofi-video" as const,
		label: "Lofi Video",
		description: "Effect và logo",
		icon: WandSparkles,
	},
	{
		id: "text-list" as const,
		label: "TXT / File List",
		description: "Tạo và xáo danh sách",
		icon: FileText,
	},
];

export default function AutomationPage() {
	const [status, setStatus] = useState<FfmpegStatus | null>(null);
	const [selectedTool, setSelectedTool] = useState<ToolId>("auto-video");
	const [activeJob, setActiveJob] = useState<ToolId | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [jobs, setJobs] = useState<CompletedJob[]>([]);
	const [joinAudioFiles, setJoinAudioFiles] = useState<File[]>([]);
	const [pinnedAudioFiles, setPinnedAudioFiles] = useState<File[]>([]);
	const [audioDurations, setAudioDurations] = useState<Record<string, number>>(
		{},
	);
	const [autoGoodFiles, setAutoGoodFiles] = useState<File[]>([]);
	const [autoOtherFiles, setAutoOtherFiles] = useState<File[]>([]);
	const [autoMp3Progress, setAutoMp3Progress] = useState<{
		current: number;
		total: number;
	} | null>(null);
	const [desktopMode, setDesktopMode] = useState(false);
	const [desktopAudioPath, setDesktopAudioPath] = useState("");
	const [desktopVideoFolder, setDesktopVideoFolder] = useState("");
	const [desktopVideoPaths, setDesktopVideoPaths] = useState<string[]>([]);
	const [desktopAutoVideoLogo, setDesktopAutoVideoLogo] = useState("");
	const [desktopGoodFolder, setDesktopGoodFolder] = useState("");
	const [desktopOtherFolder, setDesktopOtherFolder] = useState("");
	const [desktopGoodPaths, setDesktopGoodPaths] = useState<string[]>([]);
	const [desktopOtherPaths, setDesktopOtherPaths] = useState<string[]>([]);
	const [desktopJoinFiles, setDesktopJoinFiles] = useState<DesktopAudio[]>([]);
	const [desktopPinnedPaths, setDesktopPinnedPaths] = useState<string[]>([]);
	const [desktopConvertPath, setDesktopConvertPath] = useState("");
	const [desktopImagePath, setDesktopImagePath] = useState("");
	const [desktopImageAudioPath, setDesktopImageAudioPath] = useState("");
	const [desktopFramesVideoPath, setDesktopFramesVideoPath] = useState("");
	const [desktopFramesOutputFolder, setDesktopFramesOutputFolder] = useState("");
	const [desktopJoinVideoFiles, setDesktopJoinVideoFiles] = useState<DesktopAudio[]>([]);
	const [desktopPinnedVideoPaths, setDesktopPinnedVideoPaths] = useState<string[]>([]);
	const [desktopLofiBackground, setDesktopLofiBackground] = useState("");
	const [desktopLofiAudio, setDesktopLofiAudio] = useState("");
	const [desktopLofiEffect, setDesktopLofiEffect] = useState("");
	const [desktopLofiLogo, setDesktopLofiLogo] = useState("");
	const [desktopListFolder, setDesktopListFolder] = useState("");
	const [desktopTextFile, setDesktopTextFile] = useState("");
	const [convertTextInput, setConvertTextInput] = useState("");
	const [convertTextResult, setConvertTextResult] = useState({
		lower: "",
		upper: "",
		title: "",
	});
	const [convertNameMode, setConvertNameMode] = useState<
		"song" | "without-singer" | "without-author" | "without-singer-keep-author"
	>("song");
	const [convertNameResult, setConvertNameResult] = useState("");
	const [desktopVideoEncoders, setDesktopVideoEncoders] = useState<string[]>(
		[],
	);
	const objectUrls = useRef<string[]>([]);
	const imageInput = useRef<HTMLInputElement>(null);
	const audioInput = useRef<HTMLInputElement>(null);
	const convertInput = useRef<HTMLInputElement>(null);
	const joinAudioInput = useRef<HTMLInputElement>(null);
	const autoVideoAudioInput = useRef<HTMLInputElement>(null);
	const backgroundsInput = useRef<HTMLInputElement>(null);
	const autoGoodInput = useRef<HTMLInputElement>(null);
	const autoOtherInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const statusPromise: Promise<unknown> = window.__TAURI__
			? window.__TAURI__.core.invoke<FfmpegStatus>("get_ffmpeg_status")
			: fetch("/api/automation/ffmpeg/status", { cache: "no-store" }).then(
					(response) => response.json(),
				);
		statusPromise
			.then((response) => parseFfmpegStatus(response))
			.then((result) => setStatus(result))
			.catch((reason: unknown) =>
				setStatus({
					enabled: false,
					available: false,
					path: null,
					version: null,
					error:
						reason instanceof Error ? reason.message : "Cannot check FFmpeg.",
				}),
			);
	}, []);

	useEffect(
		() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)),
		[],
	);
	useEffect(() => {
		const timer = window.setTimeout(
			() => setDesktopMode(Boolean(window.__TAURI__)),
			0,
		);
		return () => window.clearTimeout(timer);
	}, []);
	useEffect(() => {
		if (!desktopMode || !window.__TAURI__) return;
		void window.__TAURI__.core
			.invoke<string[]>("detect_video_encoders")
			.then(setDesktopVideoEncoders)
			.catch(() => setDesktopVideoEncoders([]));
	}, [desktopMode]);

	useEffect(() => {
		const missing = joinAudioFiles.filter(
			(file) => audioDurations[audioFileKey(file)] === undefined,
		);
		if (missing.length === 0) return;
		let cancelled = false;
		void Promise.all(
			missing.map(
				async (file) =>
					[audioFileKey(file), await readAudioDuration(file)] as const,
			),
		).then((entries) => {
			if (!cancelled)
				setAudioDurations((current) => ({
					...current,
					...Object.fromEntries(entries),
				}));
		});
		return () => {
			cancelled = true;
		};
	}, [joinAudioFiles, audioDurations]);

	const runTool = async ({
		event,
		tool,
		endpoint,
		filename,
	}: {
		event: FormEvent<HTMLFormElement>;
		tool: ToolId;
		endpoint: string;
		filename: string;
	}) => {
		event.preventDefault();
		setError(null);
		const data = new FormData(event.currentTarget);
		setActiveJob(tool);
		try {
			const response = await fetch(endpoint, { method: "POST", body: data });
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				const message =
					typeof body === "object" &&
					body !== null &&
					"error" in body &&
					typeof body.error === "string"
						? body.error
						: null;
				throw new Error(message ?? `Render failed (${response.status}).`);
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			objectUrls.current.push(url);
			const datedFilename = filename.replace(
				"{date}",
				new Date().toISOString().replace(/[:.]/g, "-"),
			);
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: datedFilename,
					url,
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Render thất bại.");
		} finally {
			setActiveJob(null);
		}
	};

	const handleImageAudio = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!imageInput.current?.files?.[0] || !audioInput.current?.files?.[0])
			return;
		return runTool({
			event,
			tool: "image-audio",
			endpoint: "/api/automation/image-audio",
			filename: "hovacut-{date}.mp4",
		});
	};
	const handleConvert = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!convertInput.current?.files?.[0]) return;
		const format = new FormData(event.currentTarget).get("format");
		return runTool({
			event,
			tool: "convert",
			endpoint: "/api/automation/convert",
			filename: `hovacut-converted-{date}.${format === "wav" ? "wav" : format === "mp4" ? "mp4" : "mp3"}`,
		});
	};
	const handleJoinAudio = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (joinAudioFiles.length < 2)
			return setError("Chọn ít nhất hai file audio.");
		const form = event.currentTarget;
		const exportTracks = new FormData(form).get("exportTracks") === "true";
		const data = new FormData();
		for (const file of joinAudioFiles) data.append("files", file, file.name);
		data.set("random", "false");
		data.set(
			"pinnedCount",
			String(
				joinAudioFiles.filter((file) => pinnedAudioFiles.includes(file)).length,
			),
		);
		setError(null);
		setActiveJob("join-audio");
		fetch("/api/automation/join-audio", { method: "POST", body: data })
			.then(async (response) => {
				if (!response.ok) {
					const body: unknown = await response.json().catch(() => null);
					const message =
						typeof body === "object" &&
						body !== null &&
						"error" in body &&
						typeof body.error === "string"
							? body.error
							: `Render failed (${response.status}).`;
					throw new Error(message);
				}
				return response.blob();
			})
			.then((blob) => {
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				addCompletedJob({
					blob,
					filename: `hovacut-playlist-${timestamp}.mp3`,
				});
				if (exportTracks) {
					const tracks = createCgtTracksList({
						files: joinAudioFiles,
						durations: audioDurations,
					});
					addCompletedJob({
						blob: new Blob([tracks], { type: "text/plain;charset=utf-8" }),
						filename: `hovacut-tracks-${timestamp}.txt`,
					});
				}
			})
			.catch((reason: unknown) =>
				setError(
					reason instanceof Error ? reason.message : "Ghép audio thất bại.",
				),
			)
			.finally(() => setActiveJob(null));
	};
	const addCompletedJob = ({
		blob,
		filename,
	}: {
		blob: Blob;
		filename: string;
	}) => {
		const url = URL.createObjectURL(blob);
		objectUrls.current.push(url);
		setJobs((current) => [
			{ id: crypto.randomUUID(), filename, url, createdAt: new Date() },
			...current,
		]);
	};
	const moveAudio = ({
		index,
		direction,
	}: {
		index: number;
		direction: -1 | 1;
	}) => {
		setJoinAudioFiles((current) => {
			const target = index + direction;
			if (target < 0 || target >= current.length) return current;
			if (
				pinnedAudioFiles.includes(current[index]) !==
				pinnedAudioFiles.includes(current[target])
			)
				return current;
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	};
	const shuffleAudio = () =>
		setJoinAudioFiles((current) => {
			const pinned = current.filter((file) => pinnedAudioFiles.includes(file));
			const next = current.filter((file) => !pinnedAudioFiles.includes(file));
			for (let index = next.length - 1; index > 0; index--) {
				const target = Math.floor(Math.random() * (index + 1));
				[next[index], next[target]] = [next[target], next[index]];
			}
			return [...pinned, ...next];
		});
	const togglePinnedAudio = (file: File) => {
		if (pinnedAudioFiles.includes(file)) {
			setPinnedAudioFiles((current) => current.filter((item) => item !== file));
			return;
		}
		setPinnedAudioFiles((current) => [...current, file]);
		setJoinAudioFiles((current) => {
			const remaining = current.filter((item) => item !== file);
			const pinnedCount = remaining.filter((item) =>
				pinnedAudioFiles.includes(item),
			).length;
			return [
				...remaining.slice(0, pinnedCount),
				file,
				...remaining.slice(pinnedCount),
			];
		});
	};
	const moveAudioToTop = (index: number) => {
		const file = joinAudioFiles[index];
		if (!file || index <= 0) return;
		setPinnedAudioFiles((current) => [
			file,
			...current.filter((item) => item !== file),
		]);
		setJoinAudioFiles((current) => [
			file,
			...current.filter((item) => item !== file),
		]);
	};
	const chooseDesktopMusicFolder = async (kind: "good" | "other") => {
		const folder = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: true,
		});
		if (typeof folder !== "string" || !window.__TAURI__) return;
		const paths = await window.__TAURI__.core.invoke<string[]>(
			"list_media_files",
			{
				directory: folder,
				extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "wma"],
			},
		);
		if (kind === "good") {
			setDesktopGoodFolder(folder);
			setDesktopGoodPaths(paths);
		} else {
			setDesktopOtherFolder(folder);
			setDesktopOtherPaths(paths);
		}
	};
	const chooseDesktopFile = async ({
		kind,
	}: {
		kind: "convert" | "image" | "image-audio";
	}) => {
		const filters =
			kind === "image"
				? [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }]
				: kind === "image-audio"
					? [
							{
								name: "Audio",
								extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
							},
						]
					: [
							{
								name: "Media",
								extensions: [
									"mp3",
									"wav",
									"m4a",
									"aac",
									"ogg",
									"flac",
									"mp4",
									"mov",
									"mkv",
									"webm",
									"avi",
									"m4v",
								],
							},
						];
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters,
		});
		if (typeof path !== "string") return;
		if (kind === "convert") setDesktopConvertPath(path);
		else if (kind === "image") setDesktopImagePath(path);
		else setDesktopImageAudioPath(path);
	};
	const handleDesktopConvert = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || !desktopConvertPath) return;
		const format = String(
			new FormData(event.currentTarget).get("format") ?? "mp3",
		);
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: `hovacut-converted.${format}`,
			filters: [{ name: format.toUpperCase(), extensions: [format] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("convert");
		try {
			await window.__TAURI__.core.invoke("convert_media", {
				inputPath: desktopConvertPath,
				outputPath,
				format,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: outputPath.split(/[\\/]/).pop() ?? outputPath,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string" ? reason : "Convert desktop thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const chooseFramesVideo = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: "Video",
					extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
				},
			],
		});
		if (typeof path === "string") setDesktopFramesVideoPath(path);
	};
	const chooseFramesOutputFolder = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: true,
		});
		if (typeof path === "string") setDesktopFramesOutputFolder(path);
	};
	const handleExtractVideoFrames = async (
		event: FormEvent<HTMLFormElement>,
	) => {
		event.preventDefault();
		if (
			!window.__TAURI__ ||
			!desktopFramesVideoPath ||
			!desktopFramesOutputFolder
		)
			return;
		const data = new FormData(event.currentTarget);
		const intervalSeconds = Number(data.get("interval") ?? 5);
		const format = String(data.get("image-format") ?? "jpg");
		setError(null);
		setActiveJob("video-frames");
		try {
			const result = await window.__TAURI__.core.invoke<{
				directory: string;
				count: number;
			}>("extract_video_frames", {
				inputPath: desktopFramesVideoPath,
				outputDirectory: desktopFramesOutputFolder,
				intervalSeconds,
				format,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: `${result.count} ảnh · ${result.directory}`,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string"
					? reason
					: "Không thể trích khung hình từ video.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const chooseDesktopJoinVideos = async () => {
		const selected = await window.__TAURI__?.dialog.open({
			multiple: true,
			directory: false,
			filters: [
				{
					name: "Video",
					extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
				},
			],
		});
		const paths = typeof selected === "string" ? [selected] : selected;
		if (!paths?.length || !window.__TAURI__) return;
		const additions = await Promise.all(
			paths.map(async (path) => {
				const info = await window.__TAURI__!.core.invoke<{
					name: string;
					size: number;
					lastModified: number;
				}>("inspect_media_file", { path });
				return { path, name: info.name, size: info.size, lastModified: info.lastModified };
			}),
		);
		setDesktopJoinVideoFiles((current) => {
			const existing = new Set(current.map((file) => file.path));
			return [
				...current,
				...additions.filter((file) => !existing.has(file.path)),
			].slice(0, 50);
		});
	};
	const handleJoinVideos = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || desktopJoinVideoFiles.length < 2) return;
		const data = new FormData(event.currentTarget);
		const resolution = String(data.get("resolution") ?? "1080p");
		const encoder = String(data.get("encoder") ?? "auto");
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "hovacut-joined-video.mp4",
			filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("join-video");
		try {
			await window.__TAURI__.core.invoke("join_video_files", {
				videoPaths: desktopJoinVideoFiles.map((file) => file.path),
				outputPath,
				resolution,
				encoder,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: outputPath.split(/[\\/]/).pop() ?? outputPath,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(typeof reason === "string" ? reason : "Ghép video thất bại.");
		} finally {
			setActiveJob(null);
		}
	};
	const chooseLofiFile = async (
		kind: "background" | "audio" | "effect" | "logo",
	) => {
		const filters =
			kind === "audio"
				? [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }]
				: kind === "background"
					? [{ name: "Ảnh hoặc video", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "mp4", "mov", "mkv", "webm"] }]
					: [{ name: "Video overlay", extensions: ["mp4", "mov", "mkv", "webm"] }];
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters,
		});
		if (typeof path !== "string") return;
		if (kind === "background") setDesktopLofiBackground(path);
		else if (kind === "audio") setDesktopLofiAudio(path);
		else if (kind === "effect") setDesktopLofiEffect(path);
		else setDesktopLofiLogo(path);
	};
	const handleRenderLofi = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || !desktopLofiBackground || !desktopLofiAudio) return;
		const data = new FormData(event.currentTarget);
		const resolution = String(data.get("resolution") ?? "1080p");
		const encoder = String(data.get("encoder") ?? "auto");
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "hovacut-lofi.mp4",
			filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("lofi-video");
		try {
			await window.__TAURI__.core.invoke("render_lofi_video", {
				backgroundPath: desktopLofiBackground,
				audioPath: desktopLofiAudio,
				effectPath: desktopLofiEffect || null,
				logoPath: desktopLofiLogo || null,
				outputPath,
				resolution,
				encoder,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: outputPath.split(/[\\/]/).pop() ?? outputPath,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(typeof reason === "string" ? reason : "Render Lofi thất bại.");
		} finally {
			setActiveJob(null);
		}
	};
	const chooseListFolder = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: true,
		});
		if (typeof path === "string") setDesktopListFolder(path);
	};
	const chooseTextFile = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters: [{ name: "Text", extensions: ["txt"] }],
		});
		if (typeof path === "string") setDesktopTextFile(path);
	};
	const handleCreateFileList = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || !desktopListFolder) return;
		const data = new FormData(event.currentTarget);
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "file-list.txt",
			filters: [{ name: "Text", extensions: ["txt"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("text-list");
		try {
			const count = await window.__TAURI__.core.invoke<number>(
				"create_file_list",
				{
					directory: desktopListFolder,
					outputPath,
					includeExtension: data.get("include-extension") === "true",
					shuffle: data.get("shuffle") === "true",
				},
			);
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: `${count} dòng · ${outputPath.split(/[\\/]/).pop() ?? outputPath}`,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(typeof reason === "string" ? reason : "Tạo file list thất bại.");
		} finally {
			setActiveJob(null);
		}
	};
	const handleShuffleText = async () => {
		if (!window.__TAURI__ || !desktopTextFile) return;
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "shuffled-list.txt",
			filters: [{ name: "Text", extensions: ["txt"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("text-list");
		try {
			const count = await window.__TAURI__.core.invoke<number>(
				"shuffle_text_file",
				{ inputPath: desktopTextFile, outputPath },
			);
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: `${count} dòng · ${outputPath.split(/[\\/]/).pop() ?? outputPath}`,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(typeof reason === "string" ? reason : "Xáo TXT thất bại.");
		} finally {
			setActiveJob(null);
		}
	};
	const handleConvertText = () => {
		const title = convertTextInput
			.toLocaleLowerCase("vi-VN")
			.replace(
				/(^|[\s\-–—/([{“‘])([\p{L}\p{N}])/gu,
				(_match, prefix: string, character: string) =>
					`${prefix}${character.toLocaleUpperCase("vi-VN")}`,
			);
		setConvertTextResult({
			lower: convertTextInput.toLocaleLowerCase("vi-VN"),
			upper: convertTextInput.toLocaleUpperCase("vi-VN"),
			title,
		});
	};
	const copyConvertedText = async (value: string) => {
		await navigator.clipboard.writeText(value);
	};
	const handleConvertMusicNames = () => {
		const timestamp = /^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\s*(?:[-–—|.]\s*)?/u;
		const result = convertTextInput
			.split(/\r?\n/u)
			.map((sourceLine) => {
				const line = sourceLine.trim();
				if (!line) return "";
				if (convertNameMode === "song") return line.replace(timestamp, "").trim();

				const parts = line.split(/\s+(?:-|–|—|\|)\s+/u).map((part) => part.trim());
				if (parts.length < 2) return line;
				if (convertNameMode === "without-singer") return parts[0];
				if (convertNameMode === "without-author") return parts.slice(0, -1).join(" - ");
				if (parts.length < 3) return parts[0];
				return [parts[0], ...parts.slice(2)].join(" - ");
			})
			.join("\n");
		setConvertNameResult(result);
	};
	const saveConvertedText = async (value: string, defaultPath: string) => {
		if (!window.__TAURI__ || !value) return;
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath,
			filters: [{ name: "Text", extensions: ["txt"] }],
		});
		if (!outputPath) return;
		await window.__TAURI__.core.invoke("save_export_file", {
			outputPath,
			data: Array.from(new TextEncoder().encode(value)),
		});
	};
	const handleDesktopImageAudio = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || !desktopImagePath || !desktopImageAudioPath)
			return;
		const resolution = String(
			new FormData(event.currentTarget).get("resolution") ?? "1080p",
		);
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "hovacut-image-audio.mp4",
			filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("image-audio");
		try {
			await window.__TAURI__.core.invoke("render_image_audio", {
				imagePath: desktopImagePath,
				audioPath: desktopImageAudioPath,
				outputPath,
				resolution,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: outputPath.split(/[\\/]/).pop() ?? outputPath,
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string"
					? reason
					: "Render ảnh và audio desktop thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const chooseDesktopJoinFiles = async () => {
		const selected = await window.__TAURI__?.dialog.open({
			multiple: true,
			directory: false,
			filters: [
				{
					name: "Audio",
					extensions: [
						"mp3",
						"wav",
						"m4a",
						"aac",
						"ogg",
						"flac",
						"opus",
						"wma",
					],
				},
			],
		});
		const paths = typeof selected === "string" ? [selected] : (selected ?? []);
		setDesktopJoinFiles((current) => {
			const existing = new Set(
				current.map((file) => file.path.toLocaleLowerCase()),
			);
			return [
				...current,
				...paths
					.filter((path) => !existing.has(path.toLocaleLowerCase()))
					.map((path) => ({
						path,
						name: path.split(/[\\/]/).pop() ?? path,
						size: 0,
						lastModified: 0,
					})),
			].slice(0, 50);
		});
	};
	const handleDesktopJoinAudio = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__ || desktopJoinFiles.length < 2) return;
		const form = new FormData(event.currentTarget);
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "hovacut-playlist.mp3",
			filters: [{ name: "MP3 Audio", extensions: ["mp3"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("join-audio");
		try {
			const outputs = await window.__TAURI__.core.invoke<string[]>(
				"render_join_audio",
				{
					audioPaths: desktopJoinFiles.map((file) => file.path),
					outputPath,
					exportTracks: form.get("exportTracks") === "true",
				},
			);
			setJobs((current) => [
				...outputs.map((path) => ({
					id: crypto.randomUUID(),
					filename: path.split(/[\\/]/).pop() ?? path,
					url: "",
					createdAt: new Date(),
				})),
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string" ? reason : "Ghép audio desktop thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const handleDesktopAutoMp3 = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!window.__TAURI__) return;
		const form = new FormData(event.currentTarget);
		const outputDirectory = await window.__TAURI__.dialog.open({
			multiple: false,
			directory: true,
		});
		if (typeof outputDirectory !== "string") return;
		setError(null);
		setActiveJob("auto-mp3");
		try {
			const outputs = await window.__TAURI__.core.invoke<string[]>(
				"render_auto_mp3",
				{
					goodPaths: desktopGoodPaths,
					otherPaths: desktopOtherPaths,
					goodCount: Number(form.get("goodCount")),
					otherCount: Number(form.get("otherCount")),
					outputCount: Number(form.get("outputCount")),
					outputDirectory,
				},
			);
			setJobs((current) => [
				...outputs.map((path) => ({
					id: crypto.randomUUID(),
					filename: path.split(/[\\/]/).pop() ?? path,
					url: "",
					createdAt: new Date(),
				})),
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string" ? reason : "Tạo Auto MP3 desktop thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const handleAutoMp3 = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const goodCount = Math.max(0, Math.floor(Number(form.get("goodCount"))));
		const otherCount = Math.max(0, Math.floor(Number(form.get("otherCount"))));
		const outputCount = Math.max(
			1,
			Math.min(20, Math.floor(Number(form.get("outputCount")))),
		);
		if (goodCount + otherCount < 2)
			return setError("Mỗi playlist cần ít nhất 2 bài.");
		if (goodCount > autoGoodFiles.length || otherCount > autoOtherFiles.length)
			return setError("Số bài yêu cầu lớn hơn số file có trong thư mục.");
		setError(null);
		setActiveJob("auto-mp3");
		try {
			for (let index = 0; index < outputCount; index++) {
				setAutoMp3Progress({ current: index + 1, total: outputCount });
				const selected = shuffleFiles([
					...pickRandomFiles({ files: autoGoodFiles, count: goodCount }),
					...pickRandomFiles({ files: autoOtherFiles, count: otherCount }),
				]);
				const data = new FormData();
				for (const file of selected) data.append("files", file, file.name);
				data.set("random", "false");
				data.set("pinnedCount", "0");
				const response = await fetch("/api/automation/join-audio", {
					method: "POST",
					body: data,
				});
				if (!response.ok) {
					const body: unknown = await response.json().catch(() => null);
					const message =
						typeof body === "object" &&
						body !== null &&
						"error" in body &&
						typeof body.error === "string"
							? body.error
							: `Tạo playlist ${index + 1} thất bại.`;
					throw new Error(message);
				}
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				const sequence = String(index + 1).padStart(2, "0");
				addCompletedJob({
					blob: await response.blob(),
					filename: `hovacut-auto-mp3-${sequence}-${timestamp}.mp3`,
				});
				const durationEntries = await Promise.all(
					selected.map(
						async (file) =>
							[audioFileKey(file), await readAudioDuration(file)] as const,
					),
				);
				const tracks = createCgtTracksList({
					files: selected,
					durations: Object.fromEntries(durationEntries),
				});
				addCompletedJob({
					blob: new Blob([tracks], { type: "text/plain;charset=utf-8" }),
					filename: `hovacut-auto-mp3-${sequence}-${timestamp}.txt`,
				});
			}
		} catch (reason) {
			setError(
				reason instanceof Error ? reason.message : "Tạo Auto MP3 thất bại.",
			);
		} finally {
			setActiveJob(null);
			setAutoMp3Progress(null);
		}
	};
	const chooseDesktopAudio = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: "Audio",
					extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
				},
			],
		});
		if (typeof path === "string") setDesktopAudioPath(path);
	};
	const chooseDesktopVideoFolder = async () => {
		const folder = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: true,
		});
		if (typeof folder !== "string" || !window.__TAURI__) return;
		const paths = await window.__TAURI__.core.invoke<string[]>(
			"list_media_files",
			{
				directory: folder,
				extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"],
			},
		);
		setDesktopVideoFolder(folder);
		setDesktopVideoPaths(paths);
	};
	const chooseAutoVideoLogo = async () => {
		const path = await window.__TAURI__?.dialog.open({
			multiple: false,
			directory: false,
			filters: [
				{
					name: "Logo overlay",
					extensions: ["png", "webp", "jpg", "jpeg", "bmp", "mov", "mp4", "webm"],
				},
			],
		});
		if (typeof path === "string") setDesktopAutoVideoLogo(path);
	};
	const handleDesktopAutoVideo = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (
			!window.__TAURI__ ||
			!desktopAudioPath ||
			desktopVideoPaths.length === 0
		)
			return setError("Chọn audio và thư mục video.");
		const formData = new FormData(event.currentTarget);
		const resolution = String(formData.get("resolution") ?? "1080p");
		const requestedEncoder = String(
			formData.get("encoder") ?? "auto",
		);
		const encoder =
			requestedEncoder === "auto"
				? (desktopVideoEncoders[0] ?? "cpu")
				: requestedEncoder;
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: "hovacut-auto-video.mp4",
			filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
		});
		if (!outputPath) return;
		setError(null);
		setActiveJob("auto-video");
		try {
			await window.__TAURI__.core.invoke("render_auto_video", {
				audioPath: desktopAudioPath,
				videoPaths: desktopVideoPaths,
				logoPath: desktopAutoVideoLogo || null,
				logoMode: String(formData.get("logo-mode") ?? "corner"),
				logoPosition: String(formData.get("logo-position") ?? "top-right"),
				logoWidthPercent: Number(formData.get("logo-width") ?? 18),
				outputPath,
				resolution,
				encoder,
			});
			setJobs((current) => [
				{
					id: crypto.randomUUID(),
					filename: outputPath.split(/[\\/]/).pop() ?? "hovacut-auto-video.mp4",
					url: "",
					createdAt: new Date(),
				},
				...current,
			]);
		} catch (reason) {
			setError(
				typeof reason === "string"
					? reason
					: reason instanceof Error
						? reason.message
						: "Render desktop thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};
	const handleAutoVideo = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const audio = autoVideoAudioInput.current?.files?.[0];
		const backgrounds = Array.from(
			backgroundsInput.current?.files ?? [],
		).filter(
			(file) =>
				file.type.startsWith("video/") ||
				/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name),
		);
		if (!audio || backgrounds.length === 0)
			return setError("Chọn audio và ít nhất một video nền.");
		const totalBytes =
			audio.size + backgrounds.reduce((total, file) => total + file.size, 0);
		if (totalBytes > 1.5 * 1024 * 1024 * 1024)
			return setError(
				"Thư mục video vượt 1,5 GB. Bản web localhost không thể nạp an toàn; cần bản desktop để FFmpeg đọc trực tiếp đường dẫn.",
			);
		const data = new FormData();
		data.append("audio", audio, audio.name);
		for (const file of backgrounds) data.append("backgrounds", file, file.name);
		data.set(
			"resolution",
			String(new FormData(event.currentTarget).get("resolution") ?? "1080p"),
		);
		setError(null);
		setActiveJob("auto-video");
		try {
			const response = await fetch("/api/automation/auto-video", {
				method: "POST",
				body: data,
			});
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				const message =
					typeof body === "object" &&
					body !== null &&
					"error" in body &&
					typeof body.error === "string"
						? body.error
						: `Render failed (${response.status}).`;
				throw new Error(message);
			}
			addCompletedJob({
				blob: await response.blob(),
				filename: `hovacut-auto-video-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`,
			});
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Render Auto Video thất bại.",
			);
		} finally {
			setActiveJob(null);
		}
	};

	return (
		<main className="flex min-h-screen flex-col bg-muted/20">
			<header className="border-b bg-background">
				<div className="flex h-16 w-full items-center gap-4 px-5">
					<Button asChild variant="ghost" size="icon">
						<a
							href={desktopMode ? "/projects/index.html" : "/projects"}
							aria-label="Quay lại projects"
						>
							<ArrowLeft />
						</a>
					</Button>
					<div>
						<h1 className="text-lg font-semibold">HovaCut Automation</h1>
						<p className="text-xs text-muted-foreground">
							FFmpeg cho batch · OpenCut cho timeline · © 2026 HovaIT
						</p>
					</div>
					<div className="ml-auto">
						<EngineStatus status={status} />
					</div>
				</div>
			</header>

			<div className="grid w-full flex-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
				<aside className="h-fit rounded-lg border bg-background p-2 lg:sticky lg:top-4">
					<p className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Công cụ
					</p>
					<nav className="space-y-1">
						{TOOLS.map((tool) => (
							<button
								key={tool.id}
								type="button"
								onClick={() => {
									setSelectedTool(tool.id);
									setError(null);
								}}
								className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition ${selectedTool === tool.id ? "bg-foreground text-background" : "hover:bg-accent"}`}
							>
								<tool.icon className="size-5 shrink-0" />
								<span className="min-w-0">
									<span className="block text-sm font-medium">
										{tool.label}
									</span>
									<span
										className={`block text-xs ${selectedTool === tool.id ? "text-background/65" : "text-muted-foreground"}`}
									>
										{tool.description}
									</span>
								</span>
							</button>
						))}
					</nav>
				</aside>

				<section className="min-w-0">
					{error && (
						<div className="mb-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
							<CircleAlert className="mt-0.5 size-4 shrink-0" />
							{error}
						</div>
					)}
					{activeJob && (
						<ProcessingBar
							activeJob={activeJob}
							detail={
								activeJob === "auto-mp3" && autoMp3Progress
									? `Playlist ${autoMp3Progress.current}/${autoMp3Progress.total}`
									: undefined
							}
						/>
					)}
					{selectedTool === "auto-mp3" && (
						<ToolCard
							title="Auto MP3"
							description="Random nhạc từ hai thư mục và tạo nhiều playlist MP3 kèm Tracks List."
							icon={<Music2 />}
						>
							<form
								className="space-y-5"
								onSubmit={desktopMode ? handleDesktopAutoMp3 : handleAutoMp3}
							>
								<div className="grid gap-4 sm:grid-cols-2">
									{desktopMode ? (
										<>
											<DesktopPathField
												label="Thư mục Nhạc hay"
												value={desktopGoodFolder}
												detail={
													desktopGoodPaths.length
														? `${desktopGoodPaths.length} file audio`
														: undefined
												}
												action="Chọn thư mục"
												onChoose={() => void chooseDesktopMusicFolder("good")}
												icon={<Music2 />}
											/>
											<DesktopPathField
												label="Thư mục Nhạc khác"
												value={desktopOtherFolder}
												detail={
													desktopOtherPaths.length
														? `${desktopOtherPaths.length} file audio`
														: undefined
												}
												action="Chọn thư mục"
												onChoose={() => void chooseDesktopMusicFolder("other")}
												icon={<Music2 />}
											/>
										</>
									) : (
										<>
											<AudioFolderField
												inputRef={autoGoodInput}
												label="Thư mục Nhạc hay"
												files={autoGoodFiles}
												onFilesChange={setAutoGoodFiles}
											/>
											<AudioFolderField
												inputRef={autoOtherInput}
												label="Thư mục Nhạc khác"
												files={autoOtherFiles}
												onFilesChange={setAutoOtherFiles}
											/>
										</>
									)}
								</div>
								<div className="grid gap-4 sm:grid-cols-3">
									<NumberField
										name="goodCount"
										label="Số bài Nhạc hay"
										value={3}
										min={0}
										max={50}
									/>
									<NumberField
										name="otherCount"
										label="Số bài Nhạc khác"
										value={2}
										min={0}
										max={50}
									/>
									<NumberField
										name="outputCount"
										label="Số playlist xuất"
										value={1}
										min={1}
										max={20}
									/>
								</div>
								<p className="text-sm text-muted-foreground">
									{desktopMode
										? "Chế độ Desktop: đọc nhạc trực tiếp và lưu MP3 + TXT vào thư mục bạn chọn."
										: "Mỗi playlist được random độc lập, không lặp bài trong cùng playlist và tự xuất kèm Tracks List TXT."}
								</p>
								<SubmitButton
									busy={activeJob === "auto-mp3"}
									disabled={
										activeJob !== null ||
										(desktopMode
											? desktopGoodPaths.length + desktopOtherPaths.length < 2
											: !status?.available ||
												autoGoodFiles.length + autoOtherFiles.length < 2)
									}
									label="Tạo Auto MP3"
									icon={<Music2 />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "auto-video" && (
						<ToolCard
							title="Auto Video"
							description="Random thứ tự nhiều video, nối và lặp cả chuỗi cho đủ thời lượng audio."
							icon={<Clapperboard />}
						>
							<form
								className="space-y-5"
								onSubmit={
									desktopMode ? handleDesktopAutoVideo : handleAutoVideo
								}
							>
								{desktopMode ? (
									<div className="grid gap-4 sm:grid-cols-2">
										<DesktopPathField
											label="Audio chính"
											value={desktopAudioPath}
											action="Chọn audio"
											onChoose={chooseDesktopAudio}
											icon={<Music2 />}
										/>
										<DesktopPathField
											label="Thư mục video nền"
											value={desktopVideoFolder}
											detail={
												desktopVideoPaths.length
													? `${desktopVideoPaths.length} video · đọc trực tiếp từ ổ đĩa`
													: undefined
											}
											action="Chọn thư mục"
											onChoose={chooseDesktopVideoFolder}
											icon={<Clapperboard />}
										/>
									</div>
								) : (
									<>
										<FileField
											inputRef={autoVideoAudioInput}
											name="audio"
											label="Audio chính"
											accept="audio/*"
											icon={<Music2 />}
										/>
										<MultiMediaField inputRef={backgroundsInput} />
									</>
								)}
								{desktopMode ? (
									<div className="space-y-4 rounded-md border p-4">
										<div className="flex items-center justify-between gap-3">
											<div>
												<h3 className="text-sm font-medium">Logo overlay · tùy chọn</h3>
												<p className="text-xs text-muted-foreground">PNG/WebP hoặc MOV có nền trong suốt.</p>
											</div>
											<div className="flex gap-2">
												<Button type="button" variant="outline" size="sm" onClick={() => void chooseAutoVideoLogo()}>
													Chọn logo
												</Button>
												{desktopAutoVideoLogo ? (
													<Button type="button" variant="ghost" size="sm" onClick={() => setDesktopAutoVideoLogo("")}>
														Bỏ logo
													</Button>
												) : null}
											</div>
										</div>
										<p className="truncate text-xs text-muted-foreground">
											{desktopAutoVideoLogo || "Chưa chọn logo"}
										</p>
										{desktopAutoVideoLogo ? (
											<div className="grid gap-4 sm:grid-cols-3">
												<SelectField
													id="auto-logo-mode"
													name="logo-mode"
													label="Kiểu logo"
													options={[
														{ value: "full", label: "Toàn khung · như CGT" },
														{ value: "corner", label: "Logo góc" },
													]}
												/>
												<SelectField
													id="auto-logo-position"
													name="logo-position"
													label="Vị trí logo góc"
													options={[
														{ value: "top-right", label: "Trên phải" },
														{ value: "top-left", label: "Trên trái" },
														{ value: "bottom-right", label: "Dưới phải" },
														{ value: "bottom-left", label: "Dưới trái" },
														{ value: "center", label: "Chính giữa" },
													]}
												/>
												<NumberField name="logo-width" label="Chiều rộng logo (%)" value={18} min={5} max={80} />
											</div>
										) : null}
									</div>
								) : null}
								<div
									className={`grid gap-4 ${desktopMode ? "sm:grid-cols-2" : ""}`}
								>
									<SelectField
										id="auto-resolution"
										name="resolution"
										label="Độ phân giải"
										options={[
											{ value: "1080p", label: "Full HD · 1920×1080" },
											{ value: "4k", label: "4K · 3840×2160" },
										]}
									/>
									{desktopMode && (
										<SelectField
											id="auto-encoder"
											name="encoder"
											label="Bộ mã hóa video"
											options={[
												{
													value: "auto",
													label: `Tự động · ${desktopVideoEncoders[0]?.toUpperCase() ?? "CPU"}`,
												},
												...(desktopVideoEncoders.includes("nvidia")
													? [{ value: "nvidia", label: "VGA · NVIDIA NVENC" }]
													: []),
												...(desktopVideoEncoders.includes("amd")
													? [{ value: "amd", label: "VGA · AMD AMF" }]
													: []),
												...(desktopVideoEncoders.includes("intel")
													? [
															{
																value: "intel",
																label: "GPU · Intel Quick Sync",
															},
														]
													: []),
												{ value: "cpu", label: "CPU · libx264" },
											]}
										/>
									)}
								</div>
								<p className="text-sm text-muted-foreground">
									{desktopMode
										? `Chế độ Desktop · GPU khả dụng: ${desktopVideoEncoders.length ? desktopVideoEncoders.join(", ").toUpperCase() : "không tìm thấy, dùng CPU"}.`
										: "Tất cả video hợp lệ được xáo trộn và nối lại. Nếu tổng thời lượng ngắn hơn audio, toàn bộ chuỗi video được lặp lại rồi cắt vừa audio."}
								</p>
								<SubmitButton
									busy={activeJob === "auto-video"}
									disabled={
										activeJob !== null ||
										(desktopMode
											? !desktopAudioPath || desktopVideoPaths.length === 0
											: !status?.available)
									}
									label="Render Auto Video"
									icon={<Clapperboard />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "image-audio" && (
						<ToolCard
							title="Ảnh + Audio → MP4"
							description="Tạo video từ một ảnh tĩnh và một bản audio."
							icon={<WandSparkles />}
						>
							<form
								className="space-y-5"
								onSubmit={
									desktopMode ? handleDesktopImageAudio : handleImageAudio
								}
							>
								<div className="grid gap-4 sm:grid-cols-2">
									{desktopMode ? (
										<>
											<DesktopPathField
												label="Ảnh nền"
												value={desktopImagePath}
												action="Chọn ảnh"
												onChoose={() =>
													void chooseDesktopFile({ kind: "image" })
												}
												icon={<ImageIcon />}
											/>
											<DesktopPathField
												label="Audio"
												value={desktopImageAudioPath}
												action="Chọn audio"
												onChoose={() =>
													void chooseDesktopFile({ kind: "image-audio" })
												}
												icon={<Music2 />}
											/>
										</>
									) : (
										<>
											<FileField
												inputRef={imageInput}
												name="image"
												label="Ảnh nền"
												accept="image/jpeg,image/png,image/webp,image/bmp"
												icon={<ImageIcon />}
											/>
											<FileField
												inputRef={audioInput}
												name="audio"
												label="Audio"
												accept="audio/*"
												icon={<Music2 />}
											/>
										</>
									)}
								</div>
								<SelectField
									id="resolution"
									name="resolution"
									label="Độ phân giải"
									options={[
										{ value: "1080p", label: "Full HD · 1920×1080" },
										{ value: "4k", label: "4K · 3840×2160" },
									]}
								/>
								<p className="text-sm text-muted-foreground">
									Giữ đúng tỷ lệ ảnh và kết thúc theo độ dài audio.
								</p>
								<SubmitButton
									busy={activeJob === "image-audio"}
									disabled={
										activeJob !== null ||
										(desktopMode
											? !desktopImagePath || !desktopImageAudioPath
											: !status?.available)
									}
									label="Bắt đầu render"
									icon={<WandSparkles />}
								/>
							</form>
						</ToolCard>
					)}

					{selectedTool === "convert" && (
						<ToolCard
							title="Convert Media"
							description="Chuyển đổi video hoặc audio sang định dạng phổ biến."
							icon={<FileCog />}
						>
							<form
								className="space-y-5"
								onSubmit={desktopMode ? handleDesktopConvert : handleConvert}
							>
								{desktopMode ? (
									<DesktopPathField
										label="Video hoặc audio"
										value={desktopConvertPath}
										action="Chọn media"
										onChoose={() => void chooseDesktopFile({ kind: "convert" })}
										icon={<FileCog />}
									/>
								) : (
									<FileField
										inputRef={convertInput}
										name="file"
										label="Video hoặc audio"
										accept="audio/*,video/*"
										icon={<FileCog />}
									/>
								)}
								<SelectField
									id="convert-format"
									name="format"
									label="Định dạng đầu ra"
									options={[
										{ value: "mp3", label: "MP3 · 320 kbps" },
										{ value: "wav", label: "WAV · PCM 44.1 kHz" },
										{ value: "mp4", label: "MP4 · H.264/AAC" },
									]}
								/>
								<SubmitButton
									busy={activeJob === "convert"}
									disabled={
										activeJob !== null ||
										(desktopMode ? !desktopConvertPath : !status?.available)
									}
									label="Chuyển đổi"
									icon={<FileCog />}
								/>
							</form>
						</ToolCard>
					)}

					{selectedTool === "join-audio" && (
						<ToolCard
							title="Ghép / Random MP3"
							description="Sắp xếp vị trí và ghép 2–50 file thành playlist MP3 320 kbps."
							icon={<ListMusic />}
						>
							<form
								className="space-y-5"
								onSubmit={
									desktopMode ? handleDesktopJoinAudio : handleJoinAudio
								}
							>
								{desktopMode ? (
									<>
										<Button
											type="button"
											variant="outline"
											className="h-24 w-full border-dashed"
											onClick={() => void chooseDesktopJoinFiles()}
										>
											<ListMusic />{" "}
											{desktopJoinFiles.length
												? `Chọn thêm audio · đang có ${desktopJoinFiles.length}/50 file`
												: "Chọn nhiều file audio"}
										</Button>
										<DesktopPlaylistEditor
											files={desktopJoinFiles}
											pinnedPaths={desktopPinnedPaths}
											onFilesChange={setDesktopJoinFiles}
											onPinnedChange={setDesktopPinnedPaths}
										/>
									</>
								) : (
									<>
										<MultiFileField
											inputRef={joinAudioInput}
											files={joinAudioFiles}
											onFilesChange={(files) =>
												setJoinAudioFiles((current) =>
													mergeAudioFiles({ current, additions: files }),
												)
											}
										/>
										<PlaylistEditor
											files={joinAudioFiles}
											pinnedFiles={pinnedAudioFiles}
											durations={audioDurations}
											onMove={moveAudio}
											onMoveTop={moveAudioToTop}
											onTogglePin={togglePinnedAudio}
											onRemove={(index) => {
												const file = joinAudioFiles[index];
												setJoinAudioFiles((current) =>
													current.filter((_, itemIndex) => itemIndex !== index),
												);
												setPinnedAudioFiles((current) =>
													current.filter((item) => item !== file),
												);
											}}
											onClear={() => {
												setJoinAudioFiles([]);
												setPinnedAudioFiles([]);
											}}
											onShuffle={shuffleAudio}
										/>
									</>
								)}
								<label className="flex items-center gap-3 rounded-md border p-3 text-sm">
									<input
										type="checkbox"
										name="exportTracks"
										value="true"
										defaultChecked
									/>{" "}
									Xuất Tracks List (.txt) theo thứ tự danh sách hiện tại
								</label>
								<SubmitButton
									busy={activeJob === "join-audio"}
									disabled={
										activeJob !== null ||
										(desktopMode
											? desktopJoinFiles.length < 2
											: !status?.available ||
												joinAudioFiles.length < 2 ||
												joinAudioFiles.some(
													(file) =>
														audioDurations[audioFileKey(file)] === undefined,
												))
									}
									label="Tạo playlist MP3"
									icon={<Music2 />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "video-frames" && (
						<ToolCard
							title="Video → Ảnh"
							description="Trích khung hình từ video theo khoảng thời gian, tương tự VideoToImage của CGT."
							icon={<Images />}
						>
							<form className="space-y-5" onSubmit={handleExtractVideoFrames}>
								<div className="grid gap-4 sm:grid-cols-2">
									<DesktopPathField
										label="Video nguồn"
										value={desktopFramesVideoPath}
										action="Chọn video"
										onChoose={() => void chooseFramesVideo()}
										icon={<Clapperboard />}
									/>
									<DesktopPathField
										label="Thư mục lưu ảnh"
										value={desktopFramesOutputFolder}
										action="Chọn thư mục"
										onChoose={() => void chooseFramesOutputFolder()}
										icon={<Images />}
									/>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<NumberField
										name="interval"
										label="Mỗi bao nhiêu giây lấy một ảnh"
										value={5}
										min={1}
										max={3600}
									/>
									<SelectField
										id="image-format"
										name="image-format"
										label="Định dạng ảnh"
										options={[
											{ value: "jpg", label: "JPG · chất lượng cao" },
											{ value: "png", label: "PNG · không mất dữ liệu" },
										]}
									/>
								</div>
								<p className="text-sm text-muted-foreground">
									HovaCut tạo thư mục frames mới để không ghi đè ảnh cũ.
								</p>
								<SubmitButton
									busy={activeJob === "video-frames"}
									disabled={
										activeJob !== null ||
										!desktopMode ||
										!desktopFramesVideoPath ||
										!desktopFramesOutputFolder
									}
									label="Trích xuất ảnh"
									icon={<Images />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "join-video" && (
						<ToolCard
							title="Ghép / Random Video"
							description="Sắp xếp hoặc xáo trộn nhiều video rồi nối thành một MP4. Có thể chọn bổ sung nhiều lần."
							icon={<Clapperboard />}
						>
							<form className="space-y-5" onSubmit={handleJoinVideos}>
								<Button
									type="button"
									variant="outline"
									className="h-24 w-full border-dashed"
									onClick={() => void chooseDesktopJoinVideos()}
								>
									<Clapperboard />{" "}
									{desktopJoinVideoFiles.length
										? `Chọn thêm video · đang có ${desktopJoinVideoFiles.length}/50 file`
										: "Chọn nhiều file video"}
								</Button>
								<DesktopPlaylistEditor
									files={desktopJoinVideoFiles}
									pinnedPaths={desktopPinnedVideoPaths}
									onFilesChange={setDesktopJoinVideoFiles}
									onPinnedChange={setDesktopPinnedVideoPaths}
									itemLabel="video"
								/>
								<div className="grid gap-4 sm:grid-cols-2">
									<SelectField
										id="join-video-resolution"
										name="resolution"
										label="Độ phân giải"
										options={[
											{ value: "1080p", label: "Full HD · 1920×1080" },
											{ value: "4k", label: "4K · 3840×2160" },
										]}
									/>
									<SelectField
										id="join-video-encoder"
										name="encoder"
										label="Bộ mã hóa"
										options={[
											{ value: "auto", label: "CPU · tương thích" },
											...desktopVideoEncoders.map((value) => ({
												value,
												label:
													value === "nvidia"
														? "NVIDIA · NVENC"
														: value === "intel"
															? "Intel · Quick Sync"
															: "AMD · AMF",
											})),
										]}
									/>
								</div>
								<SubmitButton
									busy={activeJob === "join-video"}
									disabled={activeJob !== null || desktopJoinVideoFiles.length < 2}
									label="Ghép video"
									icon={<Clapperboard />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "lofi-video" && (
						<ToolCard
							title="Lofi Video"
							description="Tạo video dài theo audio, có thể phủ effect nền đen và logo alpha giống nhóm Lofi của CGT."
							icon={<WandSparkles />}
						>
							<form className="space-y-5" onSubmit={handleRenderLofi}>
								<div className="grid gap-4 sm:grid-cols-2">
									<DesktopPathField
										label="Ảnh hoặc video nền"
										value={desktopLofiBackground}
										action="Chọn nền"
										onChoose={() => void chooseLofiFile("background")}
										icon={<ImageIcon />}
									/>
									<DesktopPathField
										label="Audio"
										value={desktopLofiAudio}
										action="Chọn audio"
										onChoose={() => void chooseLofiFile("audio")}
										icon={<Music2 />}
									/>
									<DesktopPathField
										label="Effect tùy chọn"
										value={desktopLofiEffect}
										detail={desktopLofiEffect || "Không dùng effect"}
										action="Chọn effect"
										onChoose={() => void chooseLofiFile("effect")}
										icon={<WandSparkles />}
									/>
									<DesktopPathField
										label="Logo alpha tùy chọn"
										value={desktopLofiLogo}
										detail={desktopLofiLogo || "Không dùng logo"}
										action="Chọn logo"
										onChoose={() => void chooseLofiFile("logo")}
										icon={<ImageIcon />}
									/>
								</div>
								{desktopLofiEffect || desktopLofiLogo ? (
									<div className="flex flex-wrap gap-2">
										{desktopLofiEffect ? (
											<Button type="button" variant="outline" size="sm" onClick={() => setDesktopLofiEffect("")}>Bỏ effect</Button>
										) : null}
										{desktopLofiLogo ? (
											<Button type="button" variant="outline" size="sm" onClick={() => setDesktopLofiLogo("")}>Bỏ logo</Button>
										) : null}
									</div>
								) : null}
								<div className="grid gap-4 sm:grid-cols-2">
									<SelectField
										id="lofi-resolution"
										name="resolution"
										label="Độ phân giải"
										options={[
											{ value: "1080p", label: "Full HD · 1920×1080" },
											{ value: "4k", label: "4K · 3840×2160" },
										]}
									/>
									<SelectField
										id="lofi-encoder"
										name="encoder"
										label="Bộ mã hóa"
										options={[
											{ value: "auto", label: "CPU · tương thích" },
											...desktopVideoEncoders.map((value) => ({ value, label: value === "nvidia" ? "NVIDIA · NVENC" : value === "intel" ? "Intel · Quick Sync" : "AMD · AMF" })),
										]}
									/>
								</div>
								<SubmitButton
									busy={activeJob === "lofi-video"}
									disabled={activeJob !== null || !desktopLofiBackground || !desktopLofiAudio}
									label="Render Lofi"
									icon={<WandSparkles />}
								/>
							</form>
						</ToolCard>
					)}
					{selectedTool === "text-list" && (
						<ToolCard
							title="TXT / File List"
							description="Lấy tên toàn bộ file trong thư mục hoặc xáo trộn các dòng TXT, tương tự nhóm GET/ShuffleText của CGT."
							icon={<FileText />}
						>
							<div className="space-y-6">
								<div className="space-y-4 rounded-md border p-4">
									<h3 className="font-medium">Convert Text</h3>
									<textarea
										className="min-h-32 w-full rounded-md border bg-background p-3 text-sm"
										placeholder="Nhập hoặc dán văn bản cần chuyển đổi..."
										value={convertTextInput}
										onChange={(event) => setConvertTextInput(event.currentTarget.value)}
									/>
									<div className="flex gap-2">
										<Button type="button" onClick={handleConvertText} disabled={!convertTextInput}>
											Chuyển đổi chữ
										</Button>
										<Button
											type="button"
										variant="outline"
										onClick={() => {
											setConvertTextInput("");
											setConvertTextResult({ lower: "", upper: "", title: "" });
											setConvertNameResult("");
											}}
										>
											Xóa tất cả
										</Button>
									</div>
									{([
										["Chữ thường", "lower", "chu-thuong.txt"],
										["CHỮ HOA", "upper", "chu-hoa.txt"],
										["Hoa Chữ Cái Đầu", "title", "hoa-chu-cai-dau.txt"],
									] as const).map(([label, key, filename]) => (
										<div key={key} className="space-y-2">
											<div className="flex items-center justify-between">
												<Label>{label}</Label>
												<div className="flex gap-1">
													<Button type="button" variant="ghost" size="sm" disabled={!convertTextResult[key]} onClick={() => void copyConvertedText(convertTextResult[key])}>
														Sao chép
													</Button>
													<Button type="button" variant="ghost" size="sm" disabled={!convertTextResult[key]} onClick={() => void saveConvertedText(convertTextResult[key], filename)}>
														Lưu TXT
													</Button>
												</div>
											</div>
											<textarea className="min-h-24 w-full rounded-md border bg-muted/30 p-3 text-sm" readOnly value={convertTextResult[key]} />
										</div>
									))}
									<div className="space-y-3 rounded-md border p-3">
										<Label>Xử lý tên bài hát</Label>
										<div className="grid gap-2">
											{([
												["Lấy tên bài (xóa Time)", "song"],
												["Xóa tên Ca Sĩ (Lấy time + tên bài)", "without-singer"],
												["Xóa tên tác giả", "without-author"],
												["Xóa tên ca sĩ (Lấy time + tên bài + tác giả)", "without-singer-keep-author"],
											] as const).map(([label, value]) => (
												<label key={value} className="flex items-center gap-2 text-sm">
													<input
														type="radio"
														name="convert-name-mode"
														checked={convertNameMode === value}
														onChange={() => setConvertNameMode(value)}
													/>
													{label}
												</label>
											))}
										</div>
										<div className="flex flex-wrap gap-2">
											<Button type="button" onClick={handleConvertMusicNames} disabled={!convertTextInput}>
												Xử lý tên bài
											</Button>
											<Button type="button" variant="ghost" size="sm" disabled={!convertNameResult} onClick={() => void copyConvertedText(convertNameResult)}>
												Sao chép
											</Button>
											<Button type="button" variant="ghost" size="sm" disabled={!convertNameResult} onClick={() => void saveConvertedText(convertNameResult, "ten-bai-da-xu-ly.txt")}>
												Lưu TXT
											</Button>
										</div>
										<textarea className="min-h-28 w-full rounded-md border bg-muted/30 p-3 text-sm" readOnly value={convertNameResult} />
										<p className="text-xs text-muted-foreground">Định dạng: TIME Tên bài - Ca sĩ - Tác giả. Cũng hỗ trợ dấu –, — và |.</p>
									</div>
								</div>
								<form className="space-y-4 rounded-md border p-4" onSubmit={handleCreateFileList}>
									<h3 className="font-medium">Tạo danh sách từ thư mục</h3>
									<DesktopPathField
										label="Thư mục nguồn"
										value={desktopListFolder}
										action="Chọn thư mục"
										onChoose={() => void chooseListFolder()}
										icon={<FileText />}
									/>
									<div className="flex flex-wrap gap-4">
										<label className="flex items-center gap-2 text-sm">
											<input type="checkbox" name="include-extension" value="true" defaultChecked />
											Giữ đuôi file
										</label>
										<label className="flex items-center gap-2 text-sm">
											<input type="checkbox" name="shuffle" value="true" />
											Xáo trộn kết quả
										</label>
									</div>
									<SubmitButton
										busy={activeJob === "text-list"}
										disabled={activeJob !== null || !desktopListFolder}
										label="Xuất File List"
										icon={<FileText />}
									/>
								</form>
								<div className="space-y-4 rounded-md border p-4">
									<h3 className="font-medium">Xáo trộn TXT</h3>
									<DesktopPathField
										label="File TXT nguồn"
										value={desktopTextFile}
										action="Chọn TXT"
										onChoose={() => void chooseTextFile()}
										icon={<Shuffle />}
									/>
									<Button
										type="button"
										className="w-full"
										disabled={activeJob !== null || !desktopTextFile}
										onClick={() => void handleShuffleText()}
									>
										<Shuffle /> Xáo và lưu TXT mới
									</Button>
								</div>
							</div>
						</ToolCard>
					)}
				</section>

				<aside className="h-fit rounded-lg border bg-background lg:sticky lg:top-4">
					<div className="border-b px-4 py-3">
						<h2 className="font-semibold">Kết quả</h2>
						<p className="text-xs text-muted-foreground">
							{jobs.length} file trong phiên này
						</p>
					</div>
					<div className="max-h-[calc(100vh-7rem)] space-y-2 overflow-y-auto p-3">
						{jobs.length === 0 ? (
							<div className="rounded-md border border-dashed p-6 text-center">
								<Download className="mx-auto mb-2 size-5 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									Chưa có file kết quả
								</p>
							</div>
						) : (
							jobs.map((job) => (
								<div
									key={job.id}
									className="flex items-center gap-3 rounded-md border p-3"
								>
									<CheckCircle2 className="size-5 shrink-0 text-green-500" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium">
											{job.filename}
										</p>
										<p className="text-xs text-muted-foreground">
											{job.url
												? job.createdAt.toLocaleTimeString("vi-VN")
												: `Đã lưu · ${job.createdAt.toLocaleTimeString("vi-VN")}`}
										</p>
									</div>
									{job.url && (
										<Button asChild variant="outline" size="icon">
											<a
												href={job.url}
												download={job.filename}
												aria-label="Tải file"
											>
												<Download />
											</a>
										</Button>
									)}
								</div>
							))
						)}
					</div>
				</aside>
			</div>
		</main>
	);
}

function parseFfmpegStatus(value: unknown): FfmpegStatus {
	if (
		typeof value !== "object" ||
		value === null ||
		!("available" in value) ||
		typeof value.available !== "boolean"
	) {
		throw new Error("Invalid FFmpeg status response.");
	}
	return {
		enabled: "enabled" in value && value.enabled === true,
		available: value.available,
		path: "path" in value && typeof value.path === "string" ? value.path : null,
		version:
			"version" in value && typeof value.version === "string"
				? value.version
				: null,
		error:
			"error" in value && typeof value.error === "string"
				? value.error
				: undefined,
	};
}

function EngineStatus({ status }: { status: FfmpegStatus | null }) {
	if (!status)
		return (
			<span className="text-xs text-muted-foreground">
				Đang kiểm tra FFmpeg…
			</span>
		);
	return (
		<div
			className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${status.available ? "border-green-500/30 bg-green-500/10 text-green-600" : "border-destructive/30 bg-destructive/10 text-destructive"}`}
		>
			{status.available ? (
				<CheckCircle2 className="size-3.5" />
			) : (
				<CircleAlert className="size-3.5" />
			)}{" "}
			{status.available ? "FFmpeg sẵn sàng" : "FFmpeg chưa sẵn sàng"}
		</div>
	);
}

function ProcessingBar({
	activeJob,
	detail,
}: {
	activeJob: ToolId;
	detail?: string;
}) {
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	useEffect(() => {
		const startedAt = Date.now();
		const timer = window.setInterval(
			() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
			1000,
		);
		return () => window.clearInterval(timer);
	}, []);
	const label = TOOLS.find((tool) => tool.id === activeJob)?.label ?? "FFmpeg";
	return (
		<div className="mb-4 overflow-hidden rounded-md border border-blue-500/30 bg-blue-500/5">
			<div className="flex items-center gap-3 px-4 py-3">
				<LoaderCircle className="size-5 animate-spin text-blue-500" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-3">
						<p className="truncate text-sm font-medium">
							Đang xử lý · {label}
							{detail ? ` · ${detail}` : ""}
						</p>
						<span className="shrink-0 font-mono text-xs text-muted-foreground">
							{formatElapsedTime(elapsedSeconds)}
						</span>
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Đang upload và xử lý bằng FFmpeg, vui lòng không đóng trang.
					</p>
				</div>
			</div>
			<div className="h-1.5 overflow-hidden bg-blue-500/10">
				<div className="h-full w-full animate-pulse bg-blue-500" />
			</div>
		</div>
	);
}

function formatElapsedTime(totalSeconds: number) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function FileField({
	inputRef,
	name,
	label,
	accept,
	icon,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	name: string;
	label: string;
	accept: string;
	icon: ReactNode;
}) {
	const [filename, setFilename] = useState("");
	return (
		<label
			className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${filename ? "border-foreground/40 bg-accent/30" : ""}`}
		>
			<span className="text-muted-foreground [&_svg]:size-6">{icon}</span>
			<span className="text-sm font-medium">{label}</span>
			<span className="max-w-full truncate text-xs text-muted-foreground">
				{filename || "Nhấn để chọn file"}
			</span>
			<input
				ref={inputRef}
				className="sr-only"
				type="file"
				name={name}
				accept={accept}
				required
				onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")}
			/>
		</label>
	);
}

function MultiFileField({
	inputRef,
	files,
	onFilesChange,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	files: File[];
	onFilesChange: (files: File[]) => void;
}) {
	return (
		<label
			className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${files.length ? "border-foreground/40 bg-accent/30" : ""}`}
		>
			<ListMusic className="size-6 text-muted-foreground" />
			<span className="text-sm font-medium">
				{files.length ? "Chọn thêm file audio" : "Chọn 2–50 file audio"}
			</span>
			<span className="text-xs text-muted-foreground">
				{files.length
					? `Đang có ${files.length}/50 file · file mới sẽ được thêm vào cuối`
					: "MP3, WAV, M4A, AAC, OGG, FLAC"}
			</span>
			<input
				ref={inputRef}
				className="sr-only"
				type="file"
				name="files-picker"
				accept="audio/*"
				multiple
				onChange={(event) => {
					onFilesChange(Array.from(event.target.files ?? []));
					event.currentTarget.value = "";
				}}
			/>
		</label>
	);
}

function DesktopPathField({
	label,
	value,
	detail,
	action,
	onChoose,
	icon,
}: {
	label: string;
	value: string;
	detail?: string;
	action: string;
	onChoose: () => void;
	icon: ReactNode;
}) {
	return (
		<div
			className={`flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center ${value ? "border-foreground/40 bg-accent/30" : ""}`}
		>
			<span className="text-muted-foreground [&_svg]:size-6">{icon}</span>
			<span className="text-sm font-medium">{label}</span>
			<span className="max-w-full truncate text-xs text-muted-foreground">
				{detail ?? (value || "Chưa chọn")}
			</span>
			<Button type="button" variant="outline" size="sm" onClick={onChoose}>
				{action}
			</Button>
		</div>
	);
}

function mergeAudioFiles({
	current,
	additions,
}: {
	current: File[];
	additions: File[];
}) {
	const existing = new Set(current.map(audioFileKey));
	const uniqueAdditions = additions.filter((file) => {
		const key = audioFileKey(file);
		if (existing.has(key)) return false;
		existing.add(key);
		return true;
	});
	return [...current, ...uniqueAdditions].slice(0, 50);
}

function audioFileKey(file: File) {
	return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function pickRandomFiles({ files, count }: { files: File[]; count: number }) {
	return shuffleFiles(files).slice(0, count);
}

function shuffleFiles<T>(files: T[]): T[] {
	const result = [...files];
	for (let index = result.length - 1; index > 0; index--) {
		const target = Math.floor(Math.random() * (index + 1));
		[result[index], result[target]] = [result[target], result[index]];
	}
	return result;
}

function PlaylistEditor({
	files,
	pinnedFiles,
	durations,
	onMove,
	onMoveTop,
	onTogglePin,
	onRemove,
	onClear,
	onShuffle,
}: {
	files: File[];
	pinnedFiles: File[];
	durations: Record<string, number>;
	onMove: (options: { index: number; direction: -1 | 1 }) => void;
	onMoveTop: (index: number) => void;
	onTogglePin: (file: File) => void;
	onRemove: (index: number) => void;
	onClear: () => void;
	onShuffle: () => void;
}) {
	const loaded = files.every(
		(file) => durations[audioFileKey(file)] !== undefined,
	);
	const totalSeconds = files.reduce(
		(total, file) => total + (durations[audioFileKey(file)] ?? 0),
		0,
	);
	return (
		<div className="overflow-hidden rounded-md border">
			<div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
				<div>
					<p className="text-sm font-medium">Danh sách phát</p>
					<p className="text-xs text-muted-foreground">
						{files.length
							? `Tổng thời gian: ${loaded ? formatTrackTime(totalSeconds) : "Đang đọc…"} · ${files.length} bài`
							: "Bài ghim luôn nằm đầu và không bị xáo trộn"}
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={files.length === 0}
						onClick={onClear}
					>
						<Trash2 /> Xóa tất cả
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={files.length < 2}
						onClick={onShuffle}
					>
						<Shuffle /> Xáo trộn
					</Button>
				</div>
			</div>
			<div className="max-h-[420px] overflow-y-auto">
				{files.length === 0 ? (
					<p className="p-8 text-center text-sm text-muted-foreground">
						Chưa có bài hát trong danh sách.
					</p>
				) : (
					files.map((file, index) => {
						const pinned = pinnedFiles.includes(file);
						const duration = durations[audioFileKey(file)];
						const startSeconds = files
							.slice(0, index)
							.reduce(
								(total, previous) =>
									total + (durations[audioFileKey(previous)] ?? 0),
								0,
							);
						return (
							<div
								key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
								className={`grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2.5 last:border-b-0 ${pinned ? "bg-amber-500/10" : ""}`}
							>
								<span
									className={`flex size-7 items-center justify-center rounded text-xs font-semibold ${pinned ? "bg-amber-500 text-white" : "bg-muted"}`}
								>
									{index + 1}
								</span>
								<div className="min-w-0">
									<p className="flex items-center gap-1 truncate text-sm font-medium">
										{pinned && <Pin className="size-3 text-amber-500" />}
										{file.name}
									</p>
									<p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
										<span>
											Track:{" "}
											{loaded ? formatTrackTime(startSeconds) : "--:--:--"}
										</span>
										<span>
											Thời lượng:{" "}
											{duration === undefined
												? "Đang đọc…"
												: formatTrackTime(duration)}
										</span>
										<span>
											{formatFileSize(file.size)}
											{pinned ? " · Đã ghim" : ""}
										</span>
									</p>
								</div>
								<div className="flex items-center gap-1">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => onTogglePin(file)}
										aria-label={pinned ? "Bỏ ghim" : "Ghim bài"}
									>
										{pinned ? <PinOff /> : <Pin />}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={index === 0}
										onClick={() => onMoveTop(index)}
										aria-label="Đưa lên đầu"
									>
										<ChevronsUp />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={index === 0}
										onClick={() => onMove({ index, direction: -1 })}
										aria-label="Đưa lên"
									>
										<ArrowUp />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={index === files.length - 1}
										onClick={() => onMove({ index, direction: 1 })}
										aria-label="Đưa xuống"
									>
										<ArrowDown />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => onRemove(index)}
										aria-label="Xóa bài"
									>
										<Trash2 />
									</Button>
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

function DesktopPlaylistEditor({
	files,
	pinnedPaths,
	onFilesChange,
	onPinnedChange,
	itemLabel = "bài",
}: {
	files: DesktopAudio[];
	pinnedPaths: string[];
	onFilesChange: (files: DesktopAudio[]) => void;
	onPinnedChange: (paths: string[]) => void;
	itemLabel?: string;
}) {
	const move = ({ index, target }: { index: number; target: number }) => {
		if (target < 0 || target >= files.length) return;
		const next = [...files];
		[next[index], next[target]] = [next[target], next[index]];
		onFilesChange(next);
	};
	const pin = (file: DesktopAudio) => {
		if (pinnedPaths.includes(file.path))
			onPinnedChange(pinnedPaths.filter((path) => path !== file.path));
		else {
			onPinnedChange([...pinnedPaths, file.path]);
			onFilesChange([
				...files.filter((item) => pinnedPaths.includes(item.path)),
				file,
				...files.filter(
					(item) => !pinnedPaths.includes(item.path) && item.path !== file.path,
				),
			]);
		}
	};
	const randomize = () => {
		const pinned = files.filter((file) => pinnedPaths.includes(file.path));
		onFilesChange([
			...pinned,
			...shuffleFiles(files.filter((file) => !pinnedPaths.includes(file.path))),
		]);
	};
	return (
		<div className="overflow-hidden rounded-md border">
			<div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
				<p className="text-sm font-medium">
					Danh sách · {files.length} {itemLabel}
				</p>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={!files.length}
						onClick={() => {
							onFilesChange([]);
							onPinnedChange([]);
						}}
					>
						<Trash2 /> Xóa tất cả
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={files.length < 2}
						onClick={randomize}
					>
						<Shuffle /> Xáo trộn
					</Button>
				</div>
			</div>
			<div className="max-h-[420px] overflow-y-auto">
				{files.length === 0 ? (
					<p className="p-8 text-center text-sm text-muted-foreground">
						Chưa có {itemLabel} trong danh sách.
					</p>
				) : (
					files.map((file, index) => {
						const pinned = pinnedPaths.includes(file.path);
						return (
							<div
								key={file.path}
								className={`grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2.5 ${pinned ? "bg-amber-500/10" : ""}`}
							>
								<span className="flex size-7 items-center justify-center rounded bg-muted text-xs font-semibold">
									{index + 1}
								</span>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{file.name}</p>
									<p className="truncate text-xs text-muted-foreground">
										{file.path}
									</p>
								</div>
								<div className="flex gap-1">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => pin(file)}
									>
										{pinned ? <PinOff /> : <Pin />}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={!index}
										onClick={() => {
											onPinnedChange([
												file.path,
												...pinnedPaths.filter((path) => path !== file.path),
											]);
											onFilesChange([
												file,
												...files.filter((item) => item.path !== file.path),
											]);
										}}
									>
										<ChevronsUp />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={!index}
										onClick={() => move({ index, target: index - 1 })}
									>
										<ArrowUp />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										disabled={index === files.length - 1}
										onClick={() => move({ index, target: index + 1 })}
									>
										<ArrowDown />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										onClick={() => {
											onFilesChange(
												files.filter((item) => item.path !== file.path),
											);
											onPinnedChange(
												pinnedPaths.filter((path) => path !== file.path),
											);
										}}
									>
										<Trash2 />
									</Button>
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripAudioExtension(filename: string) {
	return filename.replace(/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i, "");
}

function createCgtTracksList({
	files,
	durations,
}: {
	files: File[];
	durations: Record<string, number>;
}) {
	let elapsedSeconds = 0;
	const lines: string[] = [];
	for (const file of files) {
		lines.push(
			`${formatTrackTime(elapsedSeconds)} ${stripAudioExtension(file.name)}`,
		);
		elapsedSeconds += durations[audioFileKey(file)] ?? 0;
	}
	return lines.join("\r\n");
}

function readAudioDuration(file: File) {
	return new Promise<number>((resolve) => {
		const url = URL.createObjectURL(file);
		const audio = document.createElement("audio");
		let settled = false;
		const finish = (duration: number) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			URL.revokeObjectURL(url);
			audio.removeAttribute("src");
			resolve(Number.isFinite(duration) ? duration : 0);
		};
		const timeout = window.setTimeout(() => finish(0), 10000);
		audio.preload = "metadata";
		audio.onloadedmetadata = () => finish(audio.duration);
		audio.onerror = () => finish(0);
		audio.src = url;
	});
}

function formatTrackTime(totalSeconds: number) {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return [hours, minutes, seconds % 60]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

function MultiMediaField({
	inputRef,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
}) {
	const [summary, setSummary] = useState("");
	useEffect(() => {
		inputRef.current?.setAttribute("webkitdirectory", "");
		inputRef.current?.setAttribute("directory", "");
	}, [inputRef]);
	return (
		<label
			className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition hover:bg-accent ${summary ? "border-foreground/40 bg-accent/30" : ""}`}
		>
			<Clapperboard className="size-7 text-muted-foreground" />
			<span className="text-sm font-medium">Chọn thư mục video nền</span>
			<span className="max-w-full truncate text-xs text-muted-foreground">
				{summary || "Quét tối đa 200 video trong thư mục"}
			</span>
			<input
				ref={inputRef}
				className="sr-only"
				type="file"
				name="backgrounds"
				accept="video/*"
				multiple
				required
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []).filter(
						(file) =>
							file.type.startsWith("video/") ||
							/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name),
					);
					const folder = files[0]?.webkitRelativePath.split("/")[0];
					setSummary(
						files.length
							? `${folder ? `${folder} · ` : ""}${files.length} video hợp lệ`
							: "Không tìm thấy video hợp lệ",
					);
				}}
			/>
		</label>
	);
}

function AudioFolderField({
	inputRef,
	label,
	files,
	onFilesChange,
}: {
	inputRef: RefObject<HTMLInputElement | null>;
	label: string;
	files: File[];
	onFilesChange: (files: File[]) => void;
}) {
	useEffect(() => {
		inputRef.current?.setAttribute("webkitdirectory", "");
		inputRef.current?.setAttribute("directory", "");
	}, [inputRef]);
	return (
		<label
			className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${files.length ? "border-foreground/40 bg-accent/30" : ""}`}
		>
			<Music2 className="size-6 text-muted-foreground" />
			<span className="text-sm font-medium">{label}</span>
			<span className="text-xs text-muted-foreground">
				{files.length ? `${files.length} file audio` : "Nhấn để chọn thư mục"}
			</span>
			<input
				ref={inputRef}
				className="sr-only"
				type="file"
				accept="audio/*"
				multiple
				onChange={(event) =>
					onFilesChange(
						Array.from(event.target.files ?? [])
							.filter(isAudioFile)
							.slice(0, 200),
					)
				}
			/>
		</label>
	);
}

function isAudioFile(file: File) {
	return (
		file.type.startsWith("audio/") ||
		/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(file.name)
	);
}

function ToolCard({
	title,
	description,
	icon,
	children,
}: {
	title: string;
	description: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader className="border-b">
				<div className="flex items-start gap-3">
					<div className="rounded-md bg-accent p-2 [&_svg]:size-5">{icon}</div>
					<div>
						<CardTitle>{title}</CardTitle>
						<p className="mt-1 text-sm text-muted-foreground">{description}</p>
					</div>
				</div>
			</CardHeader>
			<CardContent className="pt-6">{children}</CardContent>
		</Card>
	);
}

function SelectField({
	id,
	name,
	label,
	options,
}: {
	id: string;
	name: string;
	label: string;
	options: Array<{ value: string; label: string }>;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<select
				id={id}
				name={name}
				className="h-10 w-full rounded-md border bg-background px-3 text-sm"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

function NumberField({
	name,
	label,
	value,
	min,
	max,
}: {
	name: string;
	label: string;
	value: number;
	min: number;
	max: number;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={name}>{label}</Label>
			<input
				id={name}
				name={name}
				type="number"
				defaultValue={value}
				min={min}
				max={max}
				required
				className="h-10 w-full rounded-md border bg-background px-3 text-sm"
			/>
		</div>
	);
}

function SubmitButton({
	busy,
	disabled,
	label,
	icon,
}: {
	busy: boolean;
	disabled: boolean;
	label: string;
	icon: ReactNode;
}) {
	return (
		<Button type="submit" size="lg" disabled={disabled} className="w-full">
			{busy ? (
				<>
					<LoaderCircle className="animate-spin" /> Đang xử lý...
				</>
			) : (
				<>
					{icon}
					{label}
				</>
			)}
		</Button>
	);
}
