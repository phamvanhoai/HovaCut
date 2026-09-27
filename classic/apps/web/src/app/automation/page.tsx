"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, FileCog, ImageIcon, ListMusic, LoaderCircle, Music2, Shuffle, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FfmpegStatus } from "@/automation/types";

type CompletedJob = { id: string; filename: string; url: string; createdAt: Date };
type ToolId = "image-audio" | "convert" | "join-audio";

const TOOLS = [
	{ id: "image-audio" as const, label: "Ảnh + Audio", description: "Tạo video MP4", icon: ImageIcon },
	{ id: "convert" as const, label: "Convert Media", description: "Đổi định dạng", icon: FileCog },
	{ id: "join-audio" as const, label: "Ghép / Random MP3", description: "Tạo playlist", icon: ListMusic },
];

export default function AutomationPage() {
	const [status, setStatus] = useState<FfmpegStatus | null>(null);
	const [selectedTool, setSelectedTool] = useState<ToolId>("image-audio");
	const [activeJob, setActiveJob] = useState<ToolId | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [jobs, setJobs] = useState<CompletedJob[]>([]);
	const objectUrls = useRef<string[]>([]);
	const imageInput = useRef<HTMLInputElement>(null);
	const audioInput = useRef<HTMLInputElement>(null);
	const convertInput = useRef<HTMLInputElement>(null);
	const joinAudioInput = useRef<HTMLInputElement>(null);

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
		if ((joinAudioInput.current?.files?.length ?? 0) < 2) return setError("Chọn ít nhất hai file audio.");
		return runTool({ event, tool: "join-audio", endpoint: "/api/automation/join-audio", filename: "hovacut-playlist-{date}.mp3" });
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
					{selectedTool === "image-audio" && <ToolCard title="Ảnh + Audio → MP4" description="Tạo video từ một ảnh tĩnh và một bản audio." icon={<WandSparkles />}><form className="space-y-5" onSubmit={handleImageAudio}><div className="grid gap-4 sm:grid-cols-2"><FileField inputRef={imageInput} name="image" label="Ảnh nền" accept="image/jpeg,image/png,image/webp,image/bmp" icon={<ImageIcon />} /><FileField inputRef={audioInput} name="audio" label="Audio" accept="audio/*" icon={<Music2 />} /></div><SelectField id="resolution" name="resolution" label="Độ phân giải" options={[{ value: "1080p", label: "Full HD · 1920×1080" }, { value: "4k", label: "4K · 3840×2160" }]} /><p className="text-sm text-muted-foreground">Giữ đúng tỷ lệ ảnh và kết thúc theo độ dài audio.</p><SubmitButton busy={activeJob === "image-audio"} disabled={!status?.available || activeJob !== null} label="Bắt đầu render" icon={<WandSparkles />} /></form></ToolCard>}

					{selectedTool === "convert" && <ToolCard title="Convert Media" description="Chuyển đổi video hoặc audio sang định dạng phổ biến." icon={<FileCog />}><form className="space-y-5" onSubmit={handleConvert}><FileField inputRef={convertInput} name="file" label="Video hoặc audio" accept="audio/*,video/*" icon={<FileCog />} /><SelectField id="convert-format" name="format" label="Định dạng đầu ra" options={[{ value: "mp3", label: "MP3 · 320 kbps" }, { value: "wav", label: "WAV · PCM 44.1 kHz" }, { value: "mp4", label: "MP4 · H.264/AAC" }]} /><SubmitButton busy={activeJob === "convert"} disabled={!status?.available || activeJob !== null} label="Chuyển đổi" icon={<FileCog />} /></form></ToolCard>}

					{selectedTool === "join-audio" && <ToolCard title="Ghép / Random MP3" description="Ghép 2–50 file thành một playlist MP3 320 kbps." icon={<ListMusic />}><form className="space-y-5" onSubmit={handleJoinAudio}><MultiFileField inputRef={joinAudioInput} /><label className="flex items-center gap-3 rounded-md border p-3 text-sm"><input type="checkbox" name="random" value="true" /><Shuffle className="size-4" /> Xáo trộn thứ tự trước khi ghép</label><SubmitButton busy={activeJob === "join-audio"} disabled={!status?.available || activeJob !== null} label="Tạo playlist MP3" icon={<Music2 />} /></form></ToolCard>}
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

function MultiFileField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
	const [summary, setSummary] = useState("");
	return <label className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-6 text-center transition hover:bg-accent ${summary ? "border-foreground/40 bg-accent/30" : ""}`}><ListMusic className="size-7 text-muted-foreground" /><span className="text-sm font-medium">Chọn 2–50 file audio</span><span className="text-xs text-muted-foreground">{summary || "MP3, WAV, M4A, AAC, OGG, FLAC"}</span><input ref={inputRef} className="sr-only" type="file" name="files" accept="audio/*" multiple required onChange={(event) => { const files = Array.from(event.target.files ?? []); setSummary(files.length ? `${files.length} file · ${files.slice(0, 2).map((file) => file.name).join(", ")}${files.length > 2 ? "…" : ""}` : ""); }} /></label>;
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
