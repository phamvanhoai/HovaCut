"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, ImageIcon, LoaderCircle, Music2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { FfmpegStatus } from "@/automation/types";

type CompletedJob = { id: string; filename: string; url: string; createdAt: Date };

export default function AutomationPage() {
	const [status, setStatus] = useState<FfmpegStatus | null>(null);
	const [isRendering, setIsRendering] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [jobs, setJobs] = useState<CompletedJob[]>([]);
	const objectUrls = useRef<string[]>([]);
	const imageInput = useRef<HTMLInputElement>(null);
	const audioInput = useRef<HTMLInputElement>(null);

	useEffect(() => {
		fetch("/api/automation/ffmpeg/status", { cache: "no-store" })
			.then(async (response) => parseFfmpegStatus(await response.json()))
			.then((result) => setStatus(result))
			.catch((reason: unknown) => setStatus({ enabled: false, available: false, path: null, version: null, error: reason instanceof Error ? reason.message : "Cannot check FFmpeg." }));
	}, []);

	useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		const image = imageInput.current?.files?.[0];
		const audio = audioInput.current?.files?.[0];
		if (!image || !audio) return setError("Chọn đủ một ảnh và một file audio.");

		const data = new FormData(event.currentTarget);
		setIsRendering(true);
		try {
			const response = await fetch("/api/automation/image-audio", { method: "POST", body: data });
			if (!response.ok) {
				const body: unknown = await response.json().catch(() => null);
				const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null;
				throw new Error(message ?? `Render failed (${response.status}).`);
			}
			const blob = await response.blob();
			const filename = `hovacut-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
			const url = URL.createObjectURL(blob);
			objectUrls.current.push(url);
			setJobs((current) => [{ id: crypto.randomUUID(), filename, url, createdAt: new Date() }, ...current]);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Render thất bại.");
		} finally {
			setIsRendering(false);
		}
	};

	return (
		<main className="min-h-screen bg-background">
			<header className="border-b bg-background">
				<div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6">
					<Button asChild variant="ghost" size="icon"><Link href="/projects" aria-label="Quay lại projects"><ArrowLeft /></Link></Button>
					<div><h1 className="text-lg font-semibold">HovaCut Automation</h1><p className="text-xs text-muted-foreground">FFmpeg cho batch · OpenCut cho timeline</p></div>
					<div className="ml-auto"><EngineStatus status={status} /></div>
				</div>
			</header>

			<div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1fr_360px]">
				<Card>
					<CardHeader><CardTitle className="flex items-center gap-2"><WandSparkles className="size-5" /> Ảnh + Audio → MP4</CardTitle></CardHeader>
					<CardContent>
						<form className="space-y-5" onSubmit={handleSubmit}>
							<div className="grid gap-4 sm:grid-cols-2">
								<FileField inputRef={imageInput} name="image" label="Ảnh nền" accept="image/jpeg,image/png,image/webp,image/bmp" icon={<ImageIcon />} />
								<FileField inputRef={audioInput} name="audio" label="Audio" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac" icon={<Music2 />} />
							</div>
							<div className="space-y-2"><Label htmlFor="resolution">Độ phân giải</Label><select id="resolution" name="resolution" className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="1080p">Full HD · 1920×1080</option><option value="4k">4K · 3840×2160</option></select></div>
							<p className="text-sm text-muted-foreground">Ảnh được giữ đúng tỷ lệ và thêm viền nền khi cần. Video tự kết thúc theo độ dài audio.</p>
							{error && <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}
							<Button type="submit" size="lg" disabled={!status?.available || isRendering} className="w-full">{isRendering ? <><LoaderCircle className="animate-spin" /> Đang render...</> : <><WandSparkles /> Bắt đầu render</>}</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader><CardTitle>Hoàn thành</CardTitle></CardHeader>
					<CardContent className="space-y-3">
						{jobs.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Video đã render sẽ xuất hiện ở đây.</p> : jobs.map((job) => <div key={job.id} className="flex items-center gap-3 rounded-md border p-3"><CheckCircle2 className="size-5 shrink-0 text-green-500" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{job.filename}</p><p className="text-xs text-muted-foreground">{job.createdAt.toLocaleTimeString("vi-VN")}</p></div><Button asChild variant="outline" size="icon"><a href={job.url} download={job.filename} aria-label="Tải video"><Download /></a></Button></div>)}
					</CardContent>
				</Card>
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
	return <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-md border border-dashed p-5 text-center transition hover:bg-accent"><span className="text-muted-foreground [&_svg]:size-6">{icon}</span><span className="text-sm font-medium">{label}</span><span className="text-xs text-muted-foreground">Nhấn để chọn file</span><input ref={inputRef} className="sr-only" type="file" name={name} accept={accept} required /></label>;
}
