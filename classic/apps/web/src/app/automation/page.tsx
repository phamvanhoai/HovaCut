"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, CircleAlert, Clapperboard, Download, FileCog, ImageIcon, ListMusic, LoaderCircle, Music2, Shuffle, Trash2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FfmpegStatus } from "@/automation/types";

type CompletedJob = { id: string; filename: string; url: string; createdAt: Date };
type ToolId = "auto-video" | "image-audio" | "convert" | "join-audio";

const TOOLS = [
	{ id: "auto-video" as const, label: "Auto Video", description: "Random từ thư mục", icon: Clapperboard },
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
	const objectUrls = useRef<string[]>([]);
	const imageInput = useRef<HTMLInputElement>(null);
	const audioInput = useRef<HTMLInputElement>(null);
	const convertInput = useRef<HTMLInputElement>(null);
	const joinAudioInput = useRef<HTMLInputElement>(null);
	const autoVideoAudioInput = useRef<HTMLInputElement>(null);
	const backgroundsInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		fetch("/api/automation/ffmpeg/status", { cache: "no-store" })
			.then(async (response) => parseFfmpegStatus(await response.json()))
			.then((result) => setStatus(result))
			.catch((reason: unknown) => setStatus({ enabled: false, available: false, path: null, version: null, error: reason instanceof Error ? reason.message : "Cannot check FFmpeg." }));
	}, []);

	useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

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
		const data = new FormData();
		for (const file of joinAudioFiles) data.append("files", file, file.name);
		data.set("random", new FormData(form).get("random") === "true" ? "true" : "false");
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
			.then((blob) => addCompletedJob({ blob, filename: `hovacut-playlist-${new Date().toISOString().replace(/[:.]/g, "-")}.mp3` }))
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
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	};
	const shuffleAudio = () => setJoinAudioFiles((current) => {
		const next = [...current];
		for (let index = next.length - 1; index > 0; index--) {
			const target = Math.floor(Math.random() * (index + 1));
			[next[index], next[target]] = [next[target], next[index]];
		}
		return next;
	});
	const handleAutoVideo = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!autoVideoAudioInput.current?.files?.[0] || !(backgroundsInput.current?.files?.length)) return setError("Chọn audio và ít nhất một video nền.");
		return runTool({ event, tool: "auto-video", endpoint: "/api/automation/auto-video", filename: "hovacut-auto-video-{date}.mp4" });
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
					{selectedTool === "auto-video" && <ToolCard title="Auto Video" description="Chọn thư mục video, random một nền, loop theo audio và xuất MP4." icon={<Clapperboard />}><form className="space-y-5" onSubmit={handleAutoVideo}><FileField inputRef={autoVideoAudioInput} name="audio" label="Audio chính" accept="audio/*" icon={<Music2 />} /><MultiMediaField inputRef={backgroundsInput} /><SelectField id="auto-resolution" name="resolution" label="Độ phân giải" options={[{ value: "1080p", label: "Full HD · 1920×1080" }, { value: "4k", label: "4K · 3840×2160" }]} /><p className="text-sm text-muted-foreground">Hệ thống tự bỏ qua file không phải video và chọn ngẫu nhiên một video hợp lệ trong thư mục.</p><SubmitButton busy={activeJob === "auto-video"} disabled={!status?.available || activeJob !== null} label="Render Auto Video" icon={<Clapperboard />} /></form></ToolCard>}
					{selectedTool === "image-audio" && <ToolCard title="Ảnh + Audio → MP4" description="Tạo video từ một ảnh tĩnh và một bản audio." icon={<WandSparkles />}><form className="space-y-5" onSubmit={handleImageAudio}><div className="grid gap-4 sm:grid-cols-2"><FileField inputRef={imageInput} name="image" label="Ảnh nền" accept="image/jpeg,image/png,image/webp,image/bmp" icon={<ImageIcon />} /><FileField inputRef={audioInput} name="audio" label="Audio" accept="audio/*" icon={<Music2 />} /></div><SelectField id="resolution" name="resolution" label="Độ phân giải" options={[{ value: "1080p", label: "Full HD · 1920×1080" }, { value: "4k", label: "4K · 3840×2160" }]} /><p className="text-sm text-muted-foreground">Giữ đúng tỷ lệ ảnh và kết thúc theo độ dài audio.</p><SubmitButton busy={activeJob === "image-audio"} disabled={!status?.available || activeJob !== null} label="Bắt đầu render" icon={<WandSparkles />} /></form></ToolCard>}

					{selectedTool === "convert" && <ToolCard title="Convert Media" description="Chuyển đổi video hoặc audio sang định dạng phổ biến." icon={<FileCog />}><form className="space-y-5" onSubmit={handleConvert}><FileField inputRef={convertInput} name="file" label="Video hoặc audio" accept="audio/*,video/*" icon={<FileCog />} /><SelectField id="convert-format" name="format" label="Định dạng đầu ra" options={[{ value: "mp3", label: "MP3 · 320 kbps" }, { value: "wav", label: "WAV · PCM 44.1 kHz" }, { value: "mp4", label: "MP4 · H.264/AAC" }]} /><SubmitButton busy={activeJob === "convert"} disabled={!status?.available || activeJob !== null} label="Chuyển đổi" icon={<FileCog />} /></form></ToolCard>}

					{selectedTool === "join-audio" && <ToolCard title="Ghép / Random MP3" description="Sắp xếp vị trí và ghép 2–50 file thành playlist MP3 320 kbps." icon={<ListMusic />}><form className="space-y-5" onSubmit={handleJoinAudio}><MultiFileField inputRef={joinAudioInput} files={joinAudioFiles} onFilesChange={setJoinAudioFiles} /><PlaylistEditor files={joinAudioFiles} onMove={moveAudio} onRemove={(index) => setJoinAudioFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} onShuffle={shuffleAudio} /><label className="flex items-center gap-3 rounded-md border p-3 text-sm"><input type="checkbox" name="random" value="true" /><Shuffle className="size-4" /> Random lại một lần nữa trên server trước khi ghép</label><SubmitButton busy={activeJob === "join-audio"} disabled={!status?.available || activeJob !== null || joinAudioFiles.length < 2} label="Tạo playlist MP3" icon={<Music2 />} /></form></ToolCard>}
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

function FileField({ inputRef, name, label, accept, icon }: { inputRef: RefObject<HTMLInputElement | null>; name: string; label: string; accept: string; icon: ReactNode }) {
	const [filename, setFilename] = useState("");
	return <label className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${filename ? "border-foreground/40 bg-accent/30" : ""}`}><span className="text-muted-foreground [&_svg]:size-6">{icon}</span><span className="text-sm font-medium">{label}</span><span className="max-w-full truncate text-xs text-muted-foreground">{filename || "Nhấn để chọn file"}</span><input ref={inputRef} className="sr-only" type="file" name={name} accept={accept} required onChange={(event) => setFilename(event.target.files?.[0]?.name ?? "")} /></label>;
}

function MultiFileField({ inputRef, files, onFilesChange }: { inputRef: RefObject<HTMLInputElement | null>; files: File[]; onFilesChange: (files: File[]) => void }) {
	return <label className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-5 text-center transition hover:bg-accent ${files.length ? "border-foreground/40 bg-accent/30" : ""}`}><ListMusic className="size-6 text-muted-foreground" /><span className="text-sm font-medium">Chọn 2–50 file audio</span><span className="text-xs text-muted-foreground">{files.length ? `Đã chọn ${files.length} file` : "MP3, WAV, M4A, AAC, OGG, FLAC"}</span><input ref={inputRef} className="sr-only" type="file" name="files-picker" accept="audio/*" multiple onChange={(event) => onFilesChange(Array.from(event.target.files ?? []).slice(0, 50))} /></label>;
}

function PlaylistEditor({ files, onMove, onRemove, onShuffle }: { files: File[]; onMove: (options: { index: number; direction: -1 | 1 }) => void; onRemove: (index: number) => void; onShuffle: () => void }) {
	return <div className="overflow-hidden rounded-md border"><div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2"><div><p className="text-sm font-medium">Danh sách phát</p><p className="text-xs text-muted-foreground">Vị trí từ trên xuống dưới</p></div><Button type="button" variant="outline" size="sm" disabled={files.length < 2} onClick={onShuffle}><Shuffle /> Xáo trộn</Button></div><div className="max-h-[360px] overflow-y-auto">{files.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">Chưa có bài hát trong danh sách.</p> : files.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-2.5 last:border-b-0"><span className="flex size-7 items-center justify-center rounded bg-muted text-xs font-semibold">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p></div><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove({ index, direction: -1 })} aria-label="Đưa lên"><ArrowUp /></Button><Button type="button" variant="ghost" size="icon" disabled={index === files.length - 1} onClick={() => onMove({ index, direction: 1 })} aria-label="Đưa xuống"><ArrowDown /></Button><Button type="button" variant="ghost" size="icon" onClick={() => onRemove(index)} aria-label="Xóa bài"><Trash2 /></Button></div></div>)}</div></div>;
}

function formatFileSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MultiMediaField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
	const [summary, setSummary] = useState("");
	useEffect(() => {
		inputRef.current?.setAttribute("webkitdirectory", "");
		inputRef.current?.setAttribute("directory", "");
	}, [inputRef]);
	return <label className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition hover:bg-accent ${summary ? "border-foreground/40 bg-accent/30" : ""}`}><Clapperboard className="size-7 text-muted-foreground" /><span className="text-sm font-medium">Chọn thư mục video nền</span><span className="max-w-full truncate text-xs text-muted-foreground">{summary || "Quét tối đa 200 video trong thư mục"}</span><input ref={inputRef} className="sr-only" type="file" name="backgrounds" accept="video/*" multiple required onChange={(event) => { const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)); const folder = files[0]?.webkitRelativePath.split("/")[0]; setSummary(files.length ? `${folder ? `${folder} · ` : ""}${files.length} video hợp lệ` : "Không tìm thấy video hợp lệ"); }} /></label>;
}

function ToolCard({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
	return <Card><CardHeader className="border-b"><div className="flex items-start gap-3"><div className="rounded-md bg-accent p-2 [&_svg]:size-5">{icon}</div><div><CardTitle>{title}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div></CardHeader><CardContent className="pt-6">{children}</CardContent></Card>;
}

function SelectField({ id, name, label, options }: { id: string; name: string; label: string; options: Array<{ value: string; label: string }> }) {
	return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} name={name} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}

function SubmitButton({ busy, disabled, label, icon }: { busy: boolean; disabled: boolean; label: string; icon: ReactNode }) {
	return <Button type="submit" size="lg" disabled={disabled} className="w-full">{busy ? <><LoaderCircle className="animate-spin" /> Đang xử lý...</> : <>{icon}{label}</>}</Button>;
}
