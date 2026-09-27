"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronsUp, CircleAlert, Clapperboard, Download, FileCog, ImageIcon, ListMusic, LoaderCircle, Music2, Pin, PinOff, Shuffle, Trash2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FfmpegStatus } from "@/automation/types";

type CompletedJob = { id: string; filename: string; url: string; createdAt: Date };
type ToolId = "auto-video" | "auto-mp3" | "image-audio" | "convert" | "join-audio";

const TOOLS = [
	{ id: "auto-video" as const, label: "Auto Video", description: "Random từ thư mục", icon: Clapperboard },
	{ id: "auto-mp3" as const, label: "Auto MP3", description: "Tạo playlist hàng loạt", icon: Music2 },
	{ id: "image-audio" as const, label: "Ảnh + Audio", description: "Tạo video MP4", icon: ImageIcon },
	{ id: "convert" as const, label: "Convert Media", description: "Đổi định dạng", icon: FileCog },
	{ id: "join-audio" as const, label: "Ghép / Random MP3", description: "Tạo playlist", icon: ListMusic },
];

export default function AutomationPage() {
	const [status, setStatus] = useState<FfmpegStatus | null>(null);
	const [selectedTool, setSelectedTool] = useState<ToolId>("auto-video");
	const [activeJob, setActiveJob] = useState<ToolId | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [jobs, setJobs] = useState<CompletedJob[]>([]);
	const [joinAudioFiles, setJoinAudioFiles] = useState<File[]>([]);
	const [pinnedAudioFiles, setPinnedAudioFiles] = useState<File[]>([]);
	const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
	const [autoGoodFiles, setAutoGoodFiles] = useState<File[]>([]);
	const [autoOtherFiles, setAutoOtherFiles] = useState<File[]>([]);
	const [autoMp3Progress, setAutoMp3Progress] = useState<{ current: number; total: number } | null>(null);
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
		fetch("/api/automation/ffmpeg/status", { cache: "no-store" })
			.then(async (response) => parseFfmpegStatus(await response.json()))
			.then((result) => setStatus(result))
			.catch((reason: unknown) => setStatus({ enabled: false, available: false, path: null, version: null, error: reason instanceof Error ? reason.message : "Cannot check FFmpeg." }));
	}, []);

	useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

	useEffect(() => {
		const missing = joinAudioFiles.filter((file) => audioDurations[audioFileKey(file)] === undefined);
		if (missing.length === 0) return;
		let cancelled = false;
		void Promise.all(missing.map(async (file) => [audioFileKey(file), await readAudioDuration(file)] as const)).then((entries) => {
			if (!cancelled) setAudioDurations((current) => ({ ...current, ...Object.fromEntries(entries) }));
		});
		return () => { cancelled = true; };
	}, [joinAudioFiles, audioDurations]);

	const runTool = async ({ event, tool, endpoint, filename }: { event: FormEvent<HTMLFormElement>; tool: ToolId; endpoint: string; filename: string }) => {
		event.preventDefault();
		setError(null);
		const data = new FormData(event.currentTarget);
		setActiveJob(tool);
		try {
			const response = await fetch(endpoint, { method: "POST", body: data });
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
				throw new Error(message ?? `Render failed (${response.status}).`);
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			objectUrls.current.push(url);
			const datedFilename = filename.replace("{date}", new Date().toISOString().replace(/[:.]/g, "-"));
			setJobs((current) => [{ id: crypto.randomUUID(), filename: datedFilename, url, createdAt: new Date() }, ...current]);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Render thất bại.");
		} finally {
			setActiveJob(null);
		}
	};

	const handleImageAudio = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!imageInput.current?.files?.[0] || !audioInput.current?.files?.[0]) return;
		return runTool({ event, tool: "image-audio", endpoint: "/api/automation/image-audio", filename: "hovacut-{date}.mp4" });
	};
	const handleConvert = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!convertInput.current?.files?.[0]) return;
		const format = new FormData(event.currentTarget).get("format");
		return runTool({ event, tool: "convert", endpoint: "/api/automation/convert", filename: `hovacut-converted-{date}.${format === "wav" ? "wav" : format === "mp4" ? "mp4" : "mp3"}` });
	};
	const handleJoinAudio = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (joinAudioFiles.length < 2) return setError("Chọn ít nhất hai file audio.");
		const form = event.currentTarget;
		const exportTracks = new FormData(form).get("exportTracks") === "true";
		const data = new FormData();
		for (const file of joinAudioFiles) data.append("files", file, file.name);
		data.set("random", "false");
		data.set("pinnedCount", String(joinAudioFiles.filter((file) => pinnedAudioFiles.includes(file)).length));
		setError(null);
		setActiveJob("join-audio");
		fetch("/api/automation/join-audio", { method: "POST", body: data })
			.then(async (response) => {
				if (!response.ok) {
					const body: unknown = await response.json().catch(() => null);
					const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Render failed (${response.status}).`;
					throw new Error(message);
				}
				return response.blob();
			})
			.then((blob) => {
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				addCompletedJob({ blob, filename: `hovacut-playlist-${timestamp}.mp3` });
				if (exportTracks) {
					const tracks = createCgtTracksList({ files: joinAudioFiles, durations: audioDurations });
					addCompletedJob({ blob: new Blob([tracks], { type: "text/plain;charset=utf-8" }), filename: `hovacut-tracks-${timestamp}.txt` });
				}
			})
			.catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Ghép audio thất bại."))
			.finally(() => setActiveJob(null));
	};
	const addCompletedJob = ({ blob, filename }: { blob: Blob; filename: string }) => {
		const url = URL.createObjectURL(blob);
		objectUrls.current.push(url);
		setJobs((current) => [{ id: crypto.randomUUID(), filename, url, createdAt: new Date() }, ...current]);
	};
	const moveAudio = ({ index, direction }: { index: number; direction: -1 | 1 }) => {
		setJoinAudioFiles((current) => {
			const target = index + direction;
			if (target < 0 || target >= current.length) return current;
			if (pinnedAudioFiles.includes(current[index]) !== pinnedAudioFiles.includes(current[target])) return current;
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	};
	const shuffleAudio = () => setJoinAudioFiles((current) => {
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
			const pinnedCount = remaining.filter((item) => pinnedAudioFiles.includes(item)).length;
			return [...remaining.slice(0, pinnedCount), file, ...remaining.slice(pinnedCount)];
		});
	};
	const moveAudioToTop = (index: number) => {
		const file = joinAudioFiles[index];
		if (!file || index <= 0) return;
		setPinnedAudioFiles((current) => [file, ...current.filter((item) => item !== file)]);
		setJoinAudioFiles((current) => [file, ...current.filter((item) => item !== file)]);
	};
	const handleAutoMp3 = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const goodCount = Math.max(0, Math.floor(Number(form.get("goodCount"))));
		const otherCount = Math.max(0, Math.floor(Number(form.get("otherCount"))));
		const outputCount = Math.max(1, Math.min(20, Math.floor(Number(form.get("outputCount")))));
		if (goodCount + otherCount < 2) return setError("Mỗi playlist cần ít nhất 2 bài.");
		if (goodCount > autoGoodFiles.length || otherCount > autoOtherFiles.length) return setError("Số bài yêu cầu lớn hơn số file có trong thư mục.");
		setError(null);
		setActiveJob("auto-mp3");
		try {
			for (let index = 0; index < outputCount; index++) {
				setAutoMp3Progress({ current: index + 1, total: outputCount });
				const selected = shuffleFiles([...pickRandomFiles({ files: autoGoodFiles, count: goodCount }), ...pickRandomFiles({ files: autoOtherFiles, count: otherCount })]);
				const data = new FormData();
				for (const file of selected) data.append("files", file, file.name);
				data.set("random", "false");
				data.set("pinnedCount", "0");
				const response = await fetch("/api/automation/join-audio", { method: "POST", body: data });
				if (!response.ok) {
					const body: unknown = await response.json().catch(() => null);
					const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Tạo playlist ${index + 1} thất bại.`;
					throw new Error(message);
				}
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
				const sequence = String(index + 1).padStart(2, "0");
				addCompletedJob({ blob: await response.blob(), filename: `hovacut-auto-mp3-${sequence}-${timestamp}.mp3` });
				const durationEntries = await Promise.all(selected.map(async (file) => [audioFileKey(file), await readAudioDuration(file)] as const));
				const tracks = createCgtTracksList({ files: selected, durations: Object.fromEntries(durationEntries) });
				addCompletedJob({ blob: new Blob([tracks], { type: "text/plain;charset=utf-8" }), filename: `hovacut-auto-mp3-${sequence}-${timestamp}.txt` });
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Tạo Auto MP3 thất bại.");
		} finally {
			setActiveJob(null);
			setAutoMp3Progress(null);
		}
	};
	const handleAutoVideo = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const audio = autoVideoAudioInput.current?.files?.[0];
		const backgrounds = Array.from(backgroundsInput.current?.files ?? []).filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name));
		if (!audio || backgrounds.length === 0) return setError("Chọn audio và ít nhất một video nền.");
		const totalBytes = audio.size + backgrounds.reduce((total, file) => total + file.size, 0);
		if (totalBytes > 1.5 * 1024 * 1024 * 1024) return setError("Thư mục video vượt 1,5 GB. Bản web localhost không thể nạp an toàn; cần bản desktop để FFmpeg đọc trực tiếp đường dẫn.");
		const data = new FormData();
		data.append("audio", audio, audio.name);
		for (const file of backgrounds) data.append("backgrounds", file, file.name);
		data.set("resolution", String(new FormData(event.currentTarget).get("resolution") ?? "1080p"));
		setError(null);
		setActiveJob("auto-video");
		try {
			const response = await fetch("/api/automation/auto-video", { method: "POST", body: data });
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Render failed (${response.status}).`;
				throw new Error(message);
			}
			addCompletedJob({ blob: await response.blob(), filename: `hovacut-auto-video-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4` });
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Render Auto Video thất bại.");
		} finally {
			setActiveJob(null);
		}
	};

	return (
		<main className="flex min-h-screen flex-col bg-muted/20">
			<header className="border-b bg-background">
				<div className="flex h-16 w-full items-center gap-4 px-5">
					<Button asChild variant="ghost" size="icon"><Link href="/projects" aria-label="Quay lại projects"><ArrowLeft /></Link></Button>
					<div><h1 className="text-lg font-semibold">HovaCut Automation</h1><p className="text-xs text-muted-foreground">FFmpeg cho batch · OpenCut cho timeline</p></div>
					<div className="ml-auto"><EngineStatus status={status} /></div>
				</div>
			</header>

			<div className="grid w-full flex-1 gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
				<aside className="h-fit rounded-lg border bg-background p-2 lg:sticky lg:top-4">
					<p className="px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Công cụ</p>
					<nav className="space-y-1">{TOOLS.map((tool) => <button key={tool.id} type="button" onClick={() => { setSelectedTool(tool.id); setError(null); }} className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition ${selectedTool === tool.id ? "bg-foreground text-background" : "hover:bg-accent"}`}><tool.icon className="size-5 shrink-0" /><span className="min-w-0"><span className="block text-sm font-medium">{tool.label}</span><span className={`block text-xs ${selectedTool === tool.id ? "text-background/65" : "text-muted-foreground"}`}>{tool.description}</span></span></button>)}</nav>
				</aside>

				<section className="min-w-0">
					{error && <div className="mb-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}
					{activeJob && <ProcessingBar activeJob={activeJob} detail={activeJob === "auto-mp3" && autoMp3Progress ? `Playlist ${autoMp3Progress.current}/${autoMp3Progress.total}` : undefined} />}
					{selectedTool === "auto-mp3" && <ToolCard title="Auto MP3" description="Random nhạc từ hai thư mục và tạo nhiều playlist MP3 kèm Tracks List." icon={<Music2 />}><form className="space-y-5" onSubmit={handleAutoMp3}><div className="grid gap-4 sm:grid-cols-2"><AudioFolderField inputRef={autoGoodInput} label="Thư mục Nhạc hay" files={autoGoodFiles} onFilesChange={setAutoGoodFiles} /><AudioFolderField inputRef={autoOtherInput} label="Thư mục Nhạc khác" files={autoOtherFiles} onFilesChange={setAutoOtherFiles} /></div><div className="grid gap-4 sm:grid-cols-3"><NumberField name="goodCount" label="Số bài Nhạc hay" value={3} min={0} max={50} /><NumberField name="otherCount" label="Số bài Nhạc khác" value={2} min={0} max={50} /><NumberField name="outputCount" label="Số playlist xuất" value={1} min={1} max={20} /></div><p className="text-sm text-muted-foreground">Mỗi playlist được random độc lập, không lặp bài trong cùng playlist và tự xuất kèm Tracks List TXT.</p><SubmitButton busy={activeJob === "auto-mp3"} disabled={!status?.available || activeJob !== null || autoGoodFiles.length + autoOtherFiles.length < 2} label="Tạo Auto MP3" icon={<Music2 />} /></form></ToolCard>}
					{selectedTool === "auto-video" && <ToolCard title="Auto Video" description="Random thứ tự nhiều video, nối và lặp cả chuỗi cho đủ thời lượng audio." icon={<Clapperboard />}><form className="space-y-5" onSubmit={handleAutoVideo}><FileField inputRef={autoVideoAudioInput} name="audio" label="Audio chính" accept="audio/*" icon={<Music2 />} /><MultiMediaField inputRef={backgroundsInput} /><SelectField id="auto-resolution" name="resolution" label="Độ phân giải" options={[{ value: "1080p", label: "Full HD · 1920×1080" }, { value: "4k", label: "4K · 3840×2160" }]} /><p className="text-sm text-muted-foreground">Tất cả video hợp lệ được xáo trộn và nối lại. Nếu tổng thời lượng ngắn hơn audio, toàn bộ chuỗi video được lặp lại rồi cắt vừa audio.</p><SubmitButton busy={activeJob === "auto-video"} disabled={!status?.available || activeJob !== null} label="Render Auto Video" icon={<Clapperboard />} /></form></ToolCard>}
					{selectedTool === "image-audio" && <ToolCard title="Ảnh + Audio → MP4" description="Tạo video từ một ảnh tĩnh và một bản audio." icon={<WandSparkles />}><form className="space-y-5" onSubmit={handleImageAudio}><div className="grid gap-4 sm:grid-cols-2"><FileField inputRef={imageInput} name="image" label="Ảnh nền" accept="image/jpeg,image/png,image/webp,image/bmp" icon={<ImageIcon />} /><FileField inputRef={audioInput} name="audio" label="Audio" accept="audio/*" icon={<Music2 />} /></div><SelectField id="resolution" name="resolution" label="Độ phân giải" options={[{ value: "1080p", label: "Full HD · 1920×1080" }, { value: "4k", label: "4K · 3840×2160" }]} /><p className="text-sm text-muted-foreground">Giữ đúng tỷ lệ ảnh và kết thúc theo độ dài audio.</p><SubmitButton busy={activeJob === "image-audio"} disabled={!status?.available || activeJob !== null} label="Bắt đầu render" icon={<WandSparkles />} /></form></ToolCard>}

					{selectedTool === "convert" && <ToolCard title="Convert Media" description="Chuyển đổi video hoặc audio sang định dạng phổ biến." icon={<FileCog />}><form className="space-y-5" onSubmit={handleConvert}><FileField inputRef={convertInput} name="file" label="Video hoặc audio" accept="audio/*,video/*" icon={<FileCog />} /><SelectField id="convert-format" name="format" label="Định dạng đầu ra" options={[{ value: "mp3", label: "MP3 · 320 kbps" }, { value: "wav", label: "WAV · PCM 44.1 kHz" }, { value: "mp4", label: "MP4 · H.264/AAC" }]} /><SubmitButton busy={activeJob === "convert"} disabled={!status?.available || activeJob !== null} label="Chuyển đổi" icon={<FileCog />} /></form></ToolCard>}

					{selectedTool === "join-audio" && <ToolCard title="Ghép / Random MP3" description="Sắp xếp vị trí và ghép 2–50 file thành playlist MP3 320 kbps." icon={<ListMusic />}><form className="space-y-5" onSubmit={handleJoinAudio}><MultiFileField inputRef={joinAudioInput} files={joinAudioFiles} onFilesChange={(files) => setJoinAudioFiles((current) => mergeAudioFiles({ current, additions: files }))} /><PlaylistEditor files={joinAudioFiles} pinnedFiles={pinnedAudioFiles} durations={audioDurations} onMove={moveAudio} onMoveTop={moveAudioToTop} onTogglePin={togglePinnedAudio} onRemove={(index) => { const file = joinAudioFiles[index]; setJoinAudioFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)); setPinnedAudioFiles((current) => current.filter((item) => item !== file)); }} onClear={() => { setJoinAudioFiles([]); setPinnedAudioFiles([]); }} onShuffle={shuffleAudio} /><label className="flex items-center gap-3 rounded-md border p-3 text-sm"><input type="checkbox" name="exportTracks" value="true" defaultChecked /> Xuất Tracks List (.txt) theo thứ tự danh sách hiện tại</label><SubmitButton busy={activeJob === "join-audio"} disabled={!status?.available || activeJob !== null || joinAudioFiles.length < 2 || joinAudioFiles.some((file) => audioDurations[audioFileKey(file)] === undefined)} label="Tạo playlist MP3" icon={<Music2 />} /></form></ToolCard>}
				</section>

				<aside className="h-fit rounded-lg border bg-background lg:sticky lg:top-4"><div className="border-b px-4 py-3"><h2 className="font-semibold">Kết quả</h2><p className="text-xs text-muted-foreground">{jobs.length} file trong phiên này</p></div><div className="max-h-[calc(100vh-7rem)] space-y-2 overflow-y-auto p-3">{jobs.length === 0 ? <div className="rounded-md border border-dashed p-6 text-center"><Download className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-sm text-muted-foreground">Chưa có file kết quả</p></div> : jobs.map((job) => <div key={job.id} className="flex items-center gap-3 rounded-md border p-3"><CheckCircle2 className="size-5 shrink-0 text-green-500" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{job.filename}</p><p className="text-xs text-muted-foreground">{job.createdAt.toLocaleTimeString("vi-VN")}</p></div><Button asChild variant="outline" size="icon"><a href={job.url} download={job.filename} aria-label="Tải file"><Download /></a></Button></div>)}</div></aside>
			</div>
		</main>
	);
}

function parseFfmpegStatus(value: unknown): FfmpegStatus {
	if (typeof value !== "object" || value === null || !("available" in value) || typeof value.available !== "boolean") {
		throw new Error("Invalid FFmpeg status response.");
	}
	return {
		enabled: "enabled" in value && value.enabled === true,
		available: value.available,
		path: "path" in value && typeof value.path === "string" ? value.path : null,
		version: "version" in value && typeof value.version === "string" ? value.version : null,
		error: "error" in value && typeof value.error === "string" ? value.error : undefined,
	};
}

function EngineStatus({ status }: { status: FfmpegStatus | null }) {
	if (!status) return <span className="text-xs text-muted-foreground">Đang kiểm tra FFmpeg…</span>;
	return <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${status.available ? "border-green-500/30 bg-green-500/10 text-green-600" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{status.available ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />} {status.available ? "FFmpeg sẵn sàng" : "FFmpeg chưa sẵn sàng"}</div>;
}

function ProcessingBar({ activeJob, detail }: { activeJob: ToolId; detail?: string }) {
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	useEffect(() => {
		const startedAt = Date.now();
		const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
		return () => window.clearInterval(timer);
	}, []);
	const label = TOOLS.find((tool) => tool.id === activeJob)?.label ?? "FFmpeg";
	return <div className="mb-4 overflow-hidden rounded-md border border-blue-500/30 bg-blue-500/5"><div className="flex items-center gap-3 px-4 py-3"><LoaderCircle className="size-5 animate-spin text-blue-500" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">Đang xử lý · {label}{detail ? ` · ${detail}` : ""}</p><span className="shrink-0 font-mono text-xs text-muted-foreground">{formatElapsedTime(elapsedSeconds)}</span></div><p className="mt-0.5 text-xs text-muted-foreground">Đang upload và xử lý bằng FFmpeg, vui lòng không đóng trang.</p></div></div><div className="h-1.5 overflow-hidden bg-blue-500/10"><div className="h-full w-full animate-pulse bg-blue-500" /></div></div>;
}

function formatElapsedTime(totalSeconds: number) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function FileField({ inputRef, name, label, accept, icon }: { inputRef: RefObject<HTMLInputElement | null>; name: string; label: string; accept: string; icon: ReactNode }) {
	const [filename, setFilename] = useState("");
	return <label className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${filename ? "border-foreground/40 bg-accent/30" : ""}`}><span className="text-muted-foreground [&_svg]:size-6">{icon}</span><span className="text-sm font-medium">{label}</span><span className="max-w-full truncate text-xs text-muted-foreground">{filename || "Nhấn để chọn file"}</span><input ref={inputRef} className="sr-only" type="file" name={name} accept={accept} required onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")} /></label>;
}

function MultiFileField({ inputRef, files, onFilesChange }: { inputRef: RefObject<HTMLInputElement | null>; files: File[]; onFilesChange: (files: File[]) => void }) {
	return <label className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${files.length ? "border-foreground/40 bg-accent/30" : ""}`}><ListMusic className="size-6 text-muted-foreground" /><span className="text-sm font-medium">{files.length ? "Chọn thêm file audio" : "Chọn 2–50 file audio"}</span><span className="text-xs text-muted-foreground">{files.length ? `Đang có ${files.length}/50 file · file mới sẽ được thêm vào cuối` : "MP3, WAV, M4A, AAC, OGG, FLAC"}</span><input ref={inputRef} className="sr-only" type="file" name="files-picker" accept="audio/*" multiple onChange={(event) => { onFilesChange(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /></label>;
}

function mergeAudioFiles({ current, additions }: { current: File[]; additions: File[] }) {
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

function shuffleFiles(files: File[]) {
	const result = [...files];
	for (let index = result.length - 1; index > 0; index--) {
		const target = Math.floor(Math.random() * (index + 1));
		[result[index], result[target]] = [result[target], result[index]];
	}
	return result;
}

function PlaylistEditor({ files, pinnedFiles, durations, onMove, onMoveTop, onTogglePin, onRemove, onClear, onShuffle }: { files: File[]; pinnedFiles: File[]; durations: Record<string, number>; onMove: (options: { index: number; direction: -1 | 1 }) => void; onMoveTop: (index: number) => void; onTogglePin: (file: File) => void; onRemove: (index: number) => void; onClear: () => void; onShuffle: () => void }) {
	const loaded = files.every((file) => durations[audioFileKey(file)] !== undefined);
	const totalSeconds = files.reduce((total, file) => total + (durations[audioFileKey(file)] ?? 0), 0);
	return <div className="overflow-hidden rounded-md border"><div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2"><div><p className="text-sm font-medium">Danh sách phát</p><p className="text-xs text-muted-foreground">{files.length ? `Tổng thời gian: ${loaded ? formatTrackTime(totalSeconds) : "Đang đọc…"} · ${files.length} bài` : "Bài ghim luôn nằm đầu và không bị xáo trộn"}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={files.length === 0} onClick={onClear}><Trash2 /> Xóa tất cả</Button><Button type="button" variant="outline" size="sm" disabled={files.length < 2} onClick={onShuffle}><Shuffle /> Xáo trộn</Button></div></div><div className="max-h-[420px] overflow-y-auto">{files.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Chưa có bài hát trong danh sách.</p> : files.map((file, index) => { const pinned = pinnedFiles.includes(file); const duration = durations[audioFileKey(file)]; const startSeconds = files.slice(0, index).reduce((total, previous) => total + (durations[audioFileKey(previous)] ?? 0), 0); return <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className={`grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2.5 last:border-b-0 ${pinned ? "bg-amber-500/10" : ""}`}><span className={`flex size-7 items-center justify-center rounded text-xs font-semibold ${pinned ? "bg-amber-500 text-white" : "bg-muted"}`}>{index + 1}</span><div className="min-w-0"><p className="flex items-center gap-1 truncate text-sm font-medium">{pinned && <Pin className="size-3 text-amber-500" />}{file.name}</p><p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>Track: {loaded ? formatTrackTime(startSeconds) : "--:--:--"}</span><span>Thời lượng: {duration === undefined ? "Đang đọc…" : formatTrackTime(duration)}</span><span>{formatFileSize(file.size)}{pinned ? " · Đã ghim" : ""}</span></p></div><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" onClick={() => onTogglePin(file)} aria-label={pinned ? "Bỏ ghim" : "Ghim bài"}>{pinned ? <PinOff /> : <Pin />}</Button><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMoveTop(index)} aria-label="Đưa lên đầu"><ChevronsUp /></Button><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove({ index, direction: -1 })} aria-label="Đưa lên"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon" disabled={index === files.length - 1} onClick={() => onMove({ index, direction: 1 })} aria-label="Đưa xuống"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon" onClick={() => onRemove(index)} aria-label="Xóa bài"><Trash2 /></Button></div></div>; })}</div></div>;
}

function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripAudioExtension(filename: string) {
	return filename.replace(/\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i, "");
}

function createCgtTracksList({ files, durations }: { files: File[]; durations: Record<string, number> }) {
	let elapsedSeconds = 0;
	const lines: string[] = [];
	for (const file of files) {
		lines.push(`${formatTrackTime(elapsedSeconds)} ${stripAudioExtension(file.name)}`);
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
	return [hours, minutes, seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
}

function MultiMediaField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
	const [summary, setSummary] = useState("");
	useEffect(() => {
		inputRef.current?.setAttribute("webkitdirectory", "");
		inputRef.current?.setAttribute("directory", "");
	}, [inputRef]);
	return <label className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition hover:bg-accent ${summary ? "border-foreground/40 bg-accent/30" : ""}`}><Clapperboard className="size-7 text-muted-foreground" /><span className="text-sm font-medium">Chọn thư mục video nền</span><span className="max-w-full truncate text-xs text-muted-foreground">{summary || "Quét tối đa 200 video trong thư mục"}</span><input ref={inputRef} className="sr-only" type="file" name="backgrounds" accept="video/*" multiple required onChange={(event) => { const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)); const folder = files[0]?.webkitRelativePath.split("/")[0]; setSummary(files.length ? `${folder ? `${folder} · ` : ""}${files.length} video hợp lệ` : "Không tìm thấy video hợp lệ"); }} /></label>;
}

function AudioFolderField({ inputRef, label, files, onFilesChange }: { inputRef: RefObject<HTMLInputElement | null>; label: string; files: File[]; onFilesChange: (files: File[]) => void }) {
	useEffect(() => {
		inputRef.current?.setAttribute("webkitdirectory", "");
		inputRef.current?.setAttribute("directory", "");
	}, [inputRef]);
	return <label className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${files.length ? "border-foreground/40 bg-accent/30" : ""}`}><Music2 className="size-6 text-muted-foreground" /><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">{files.length ? `${files.length} file audio` : "Nhấn để chọn thư mục"}</span><input ref={inputRef} className="sr-only" type="file" accept="audio/*" multiple onChange={(event) => onFilesChange(Array.from(event.target.files ?? []).filter(isAudioFile).slice(0, 200))} /></label>;
}

function isAudioFile(file: File) {
	return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma)$/i.test(file.name);
}

function ToolCard({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
	return <Card><CardHeader className="border-b"><div className="flex items-start gap-3"><div className="rounded-md bg-accent p-2 [&_svg]:size-5">{icon}</div><div><CardTitle>{title}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div></CardHeader><CardContent className="pt-6">{children}</CardContent></Card>;
}

function SelectField({ id, name, label, options }: { id: string; name: string; label: string; options: Array<{ value: string; label: string }> }) {
	return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} name={name} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function NumberField({ name, label, value, min, max }: { name: string; label: string; value: number; min: number; max: number }) {
	return <div className="space-y-2"><Label htmlFor={name}>{label}</Label><input id={name} name={name} type="number" defaultValue={value} min={min} max={max} required className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></div>;
}

function SubmitButton({ busy, disabled, label, icon }: { busy: boolean; disabled: boolean; label: string; icon: ReactNode }) {
	return <Button type="submit" size="lg" disabled={disabled} className="w-full">{busy ? <><LoaderCircle className="animate-spin" /> Đang xử lý...</> : <>{icon}{label}</>}</Button>;
}
