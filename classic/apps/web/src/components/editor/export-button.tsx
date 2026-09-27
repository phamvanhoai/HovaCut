"use client";

import { useEffect, useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils/ui";
import {
	getExportMimeType,
	getExportFileExtension,
	downloadBuffer,
} from "@/export";
import { Check, Copy, Download, RotateCcw } from "lucide-react";
import {
	EXPORT_FORMAT_VALUES,
	EXPORT_QUALITY_VALUES,
	type ExportFormat,
	type ExportQuality,
} from "@/export";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";
import { TICKS_PER_SECOND } from "@/wasm";
import { toast } from "sonner";
import { buildTransformFromParams, readOpacityFromParams } from "@/rendering";
import type { TimelineElement } from "@/timeline";

function isExportFormat(value: string): value is ExportFormat {
	return EXPORT_FORMAT_VALUES.some((formatValue) => formatValue === value);
}

function isExportQuality(value: string): value is ExportQuality {
	return EXPORT_QUALITY_VALUES.some((qualityValue) => qualityValue === value);
}

export function ExportButton() {
	const [isExportPopoverOpen, setIsExportPopoverOpen] = useState(false);
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const hasProject = !!activeProject;

	const handlePopoverOpenChange = ({ open }: { open: boolean }) => {
		if (!open) {
			editor.project.cancelExport();
			editor.project.clearExportState();
		}
		setIsExportPopoverOpen(open);
	};

	return (
		<Popover
			open={isExportPopoverOpen}
			onOpenChange={(open) => handlePopoverOpenChange({ open })}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex items-center gap-1.5 rounded-md bg-[#38BDF8] px-[0.12rem] py-[0.12rem] text-white",
						hasProject ? "cursor-pointer" : "cursor-not-allowed opacity-50",
					)}
					onClick={hasProject ? () => setIsExportPopoverOpen(true) : undefined}
					disabled={!hasProject}
					onKeyDown={(event) => {
						if (hasProject && (event.key === "Enter" || event.key === " ")) {
							event.preventDefault();
							setIsExportPopoverOpen(true);
						}
					}}
				>
					<div className="relative flex items-center gap-1.5 rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7] px-4 py-1 shadow-[0_1px_3px_0px_rgba(0,0,0,0.65)]">
						<HugeiconsIcon icon={TransitionTopIcon} className="z-50 size-3.5" />
						<span className="z-50 text-[0.875rem]">Export</span>
						<div className="absolute top-0 left-0 z-10 flex size-full items-center justify-center rounded-[0.6rem] bg-linear-to-t from-white/0 to-white/50">
							<div className="absolute top-[0.08rem] z-50 h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-[0.6rem] bg-linear-270 from-[#2567EC] to-[#37B6F7]"></div>
						</div>
					</div>
				</button>
			</PopoverTrigger>
			{hasProject && <ExportPopover onOpenChange={setIsExportPopoverOpen} />}
		</Popover>
	);
}

function ExportPopover({
	onOpenChange,
}: {
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const exportState = useEditor((e) => e.project.getExportState());
	const { isExporting, progress, result: exportResult } = exportState;
	const [format, setFormat] = useState<ExportFormat>(
		DEFAULT_EXPORT_OPTIONS.format,
	);
	const [quality, setQuality] = useState<ExportQuality>(
		DEFAULT_EXPORT_OPTIONS.quality,
	);
	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
		DEFAULT_EXPORT_OPTIONS.includeAudio ?? true,
	);
	const [isNativeExporting, setIsNativeExporting] = useState(false);
	const [nativeProgress, setNativeProgress] = useState(0);
	const [nativeEncoders, setNativeEncoders] = useState<string[]>([]);
	const [nativeEncoder, setNativeEncoder] = useState("cpu");

	useEffect(() => {
		if (!window.__TAURI__) return;
		void window.__TAURI__.core
			.invoke<string[]>("detect_video_encoders")
			.then((encoders) => {
				setNativeEncoders(encoders);
				setNativeEncoder(
					encoders.includes("nvidia")
						? "nvidia"
						: encoders.includes("intel")
							? "intel"
							: encoders.includes("amd")
								? "amd"
								: "cpu",
				);
			});
	}, []);

	useEffect(() => {
		if (!window.__TAURI__) return;
		let unlisten: (() => void) | undefined;
		void window.__TAURI__.event
			.listen<number>("native-export-progress", (event) => {
				setNativeProgress(Math.round(event.payload * 100));
			})
			.then((dispose) => {
				unlisten = dispose;
			});
		return () => unlisten?.();
	}, []);

	const handleNativeExport = async () => {
		if (!window.__TAURI__) return;
		if (activeProject.settings.background.type === "blur") {
			toast.error(
				"Background blur chưa hỗ trợ Native GPU; hãy dùng màu nền hoặc Export OpenCut.",
			);
			return;
		}
		const scene = editor.scenes.getActiveScene();
		const assets = new Map(
			editor.media.getAssets().map((asset) => [asset.id, asset]),
		);
		const getNativeBlur = (element: TimelineElement) => {
			if (!("effects" in element)) return 0;
			const blur = element.effects?.find(
				(effect) => effect.enabled && effect.type === "blur",
			);
			const intensity = blur?.params.intensity;
			return typeof intensity === "number" ? intensity / 5 : 0;
		};
		const hasUnsupportedEffects = (element: TimelineElement) =>
			"effects" in element &&
			(element.effects?.some(
				(effect) =>
					effect.enabled && (effect.type !== "blur" || element.type === "text"),
			) ??
				false);
		const overlayElements = scene.tracks.overlay.reduce<TimelineElement[]>(
			(all, track) => [...all, ...track.elements],
			[],
		);
		const hasUnsupportedOverlay = overlayElements.some((element) => {
			if (
				element.type !== "video" &&
				element.type !== "image" &&
				element.type !== "text"
			)
				return true;
			const transform = buildTransformFromParams({ params: element.params });
			return (
				(element.type === "text" && transform.rotate !== 0) ||
				Boolean(element.animations) ||
				hasUnsupportedEffects(element) ||
				("masks" in element && (element.masks?.length ?? 0) > 0) ||
				(typeof element.params.blendMode === "string" &&
					element.params.blendMode !== "normal")
			);
		});
		if (hasUnsupportedOverlay) {
			toast.error(
				"Overlay có rotation, animation, mask hoặc effect chưa hỗ trợ Native GPU.",
			);
			return;
		}
		const overlays = overlayElements.flatMap((element) => {
			if (element.type !== "video" && element.type !== "image") return [];
			const asset = assets.get(element.mediaId);
			if (!asset?.sourcePath || !asset.width || !asset.height) return [];
			const transform = buildTransformFromParams({ params: element.params });
			return [
				{
					path: asset.sourcePath,
					kind: element.type,
					start: element.startTime / TICKS_PER_SECOND,
					duration: element.duration / TICKS_PER_SECOND,
					trimStart: element.trimStart / TICKS_PER_SECOND,
					sourceWidth: asset.width,
					sourceHeight: asset.height,
					scaleX: transform.scaleX,
					scaleY: transform.scaleY,
					positionX: transform.position.x,
					positionY: transform.position.y,
					opacity: readOpacityFromParams({ params: element.params }),
					rotation: transform.rotate,
					blur: getNativeBlur(element),
				},
			];
		});
		const mediaOverlayCount = overlayElements.filter(
			(element) => element.type === "video" || element.type === "image",
		).length;
		if (overlays.length !== mediaOverlayCount) {
			toast.error("Một số overlay không còn file gốc hoặc thiếu kích thước.");
			return;
		}
		if (
			scene.tracks.main.elements.some((element) =>
				hasUnsupportedEffects(element),
			)
		) {
			toast.error("Main timeline có effect chưa hỗ trợ Native GPU.");
			return;
		}
		const texts = overlayElements.flatMap((element) => {
			if (element.type !== "text") return [];
			const transform = buildTransformFromParams({ params: element.params });
			return [
				{
					content:
						typeof element.params.content === "string"
							? element.params.content
							: "",
					start: element.startTime / TICKS_PER_SECOND,
					duration: element.duration / TICKS_PER_SECOND,
					fontSize:
						typeof element.params.fontSize === "number"
							? element.params.fontSize
							: 32,
					color:
						typeof element.params.color === "string"
							? element.params.color
							: "#ffffff",
					positionX: transform.position.x,
					positionY: transform.position.y,
					opacity: readOpacityFromParams({ params: element.params }),
					fontFamily:
						typeof element.params.fontFamily === "string"
							? element.params.fontFamily
							: "Arial",
					rotation: transform.rotate,
				},
			];
		});
		const sourceClips = scene.tracks.main.elements.flatMap((element) => {
			if (element.type !== "video" && element.type !== "image") return [];
			const asset = assets.get(element.mediaId);
			if (!asset?.sourcePath) return [];
			return [
				{
					path: asset.sourcePath,
					kind: element.type,
					duration: element.duration / TICKS_PER_SECOND,
					trimStart: element.trimStart / TICKS_PER_SECOND,
					rate: element.type === "video" ? (element.retime?.rate ?? 1) : 1,
					blur: getNativeBlur(element),
				},
			];
		});
		const clips: Array<{
			path: string;
			kind: string;
			duration: number;
			trimStart: number;
			rate: number;
			blur: number;
		}> = [];
		let cursor = 0;
		for (const element of [...scene.tracks.main.elements].sort(
			(a, b) => a.startTime - b.startTime,
		)) {
			const asset =
				"mediaId" in element ? assets.get(element.mediaId) : undefined;
			if (
				!asset?.sourcePath ||
				(element.type !== "video" && element.type !== "image")
			)
				continue;
			const start = element.startTime / TICKS_PER_SECOND;
			if (start > cursor)
				clips.push({
					path: "",
					kind: "blank",
					duration: start - cursor,
					trimStart: 0,
					rate: 1,
					blur: 0,
				});
			clips.push({
				path: asset.sourcePath,
				kind: element.type,
				duration: element.duration / TICKS_PER_SECOND,
				trimStart: element.trimStart / TICKS_PER_SECOND,
				rate: element.type === "video" ? (element.retime?.rate ?? 1) : 1,
				blur: getNativeBlur(element),
			});
			cursor = Math.max(cursor, start + element.duration / TICKS_PER_SECOND);
		}
		if (
			sourceClips.length !== scene.tracks.main.elements.length ||
			sourceClips.length === 0
		) {
			toast.error("Timeline phải chỉ gồm video/ảnh được nhập từ ổ đĩa.");
			return;
		}
		const audios = shouldIncludeAudio
			? [
					...scene.tracks.main.elements.flatMap((element) => {
						if (
							element.type !== "video" ||
							element.isSourceAudioEnabled === false
						)
							return [];
						const asset = assets.get(element.mediaId);
						if (!asset?.sourcePath || asset.hasAudio === false) return [];
						return [
							{
								path: asset.sourcePath,
								start: element.startTime / TICKS_PER_SECOND,
								duration: element.duration / TICKS_PER_SECOND,
								trimStart: element.trimStart / TICKS_PER_SECOND,
								volume: 1,
							},
						];
					}),
					...scene.tracks.audio.flatMap((track) =>
						track.elements.flatMap((element) => {
							if (element.sourceType !== "upload") return [];
							const asset = assets.get(element.mediaId);
							if (!asset?.sourcePath) return [];
							const volume =
								typeof element.params.volume === "number"
									? element.params.volume / 100
									: 1;
							return [
								{
									path: asset.sourcePath,
									start: element.startTime / TICKS_PER_SECOND,
									duration: element.duration / TICKS_PER_SECOND,
									trimStart: element.trimStart / TICKS_PER_SECOND,
									volume,
								},
							];
						}),
					),
				]
			: [];
		const outputPath = await window.__TAURI__.dialog.save({
			defaultPath: `${activeProject.metadata.name}.${format}`,
			filters: [
				{
					name: format === "webm" ? "WebM Video" : "MP4 Video",
					extensions: [format],
				},
			],
		});
		if (!outputPath) return;
		setIsNativeExporting(true);
		setNativeProgress(0);
		try {
			const fpsValue =
				activeProject.settings.fps.numerator /
				activeProject.settings.fps.denominator;
			await window.__TAURI__.core.invoke("render_native_timeline", {
				clips,
				overlays,
				texts,
				audios,
				outputPath,
				width: activeProject.settings.canvasSize.width,
				height: activeProject.settings.canvasSize.height,
				fps: fpsValue,
				encoder: nativeEncoder,
				quality,
				totalDuration: editor.timeline.getTotalDuration() / TICKS_PER_SECOND,
				format,
				backgroundColor: activeProject.settings.background.color,
			});
			toast.success("Đã xuất video bằng FFmpeg/GPU", {
				description: outputPath,
			});
			onOpenChange(false);
		} catch (error) {
			toast.error("Native export thất bại", {
				description: error instanceof Error ? error.message : "FFmpeg error",
			});
		} finally {
			setIsNativeExporting(false);
			setNativeProgress(0);
		}
	};

	const handleCancelNative = () => {
		void window.__TAURI__?.core.invoke("cancel_native_timeline");
	};

	const handleExport = async () => {
		if (!activeProject) return;

		const result = await editor.project.export({
			options: {
				format,
				quality,
				fps: activeProject.settings.fps,
				includeAudio: shouldIncludeAudio,
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			downloadBuffer({
				buffer: result.buffer,
				filename: `${activeProject.metadata.name}${getExportFileExtension({ format })}`,
				mimeType: getExportMimeType({ format }),
			});

			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	const handleCancel = () => {
		editor.project.cancelExport();
	};

	return (
		<PopoverContent className="bg-background mr-4 flex w-80 flex-col p-0">
			{exportResult && !exportResult.success ? (
				<ExportError
					error={exportResult.error || "Unknown error occurred"}
					onRetry={handleExport}
				/>
			) : (
				<>
					{typeof window !== "undefined" && window.__TAURI__ && !isExporting ? (
						<div className="p-3 border-b">
							<label
								className="mb-2 block text-xs text-muted-foreground"
								htmlFor="native-encoder"
							>
								GPU xuất video
							</label>
							<select
								id="native-encoder"
								className="mb-2 h-9 w-full rounded-md border bg-background px-2 text-sm"
								value={nativeEncoder}
								onChange={(event) => setNativeEncoder(event.target.value)}
								disabled={isNativeExporting || format === "webm"}
							>
								<option value="cpu">CPU · libx264</option>
								{nativeEncoders.includes("nvidia") ? (
									<option value="nvidia">NVIDIA · NVENC</option>
								) : null}
								{nativeEncoders.includes("intel") ? (
									<option value="intel">Intel · Quick Sync</option>
								) : null}
								{nativeEncoders.includes("amd") ? (
									<option value="amd">AMD · AMF</option>
								) : null}
							</select>
							{format === "webm" ? (
								<p className="mb-2 text-xs text-muted-foreground">
									WebM sử dụng VP9 bằng CPU để đảm bảo tương thích.
								</p>
							) : null}
							{isNativeExporting ? (
								<div className="mb-2 space-y-1">
									<Progress value={nativeProgress} />
									<div className="text-center text-xs text-muted-foreground">
										{nativeProgress}%
									</div>
								</div>
							) : null}
							<Button
								className="w-full"
								onClick={
									isNativeExporting ? handleCancelNative : handleNativeExport
								}
								variant={isNativeExporting ? "destructive" : "default"}
							>
								{isNativeExporting
									? "Hủy xuất video"
									: "Xuất nhanh bằng GPU (Beta)"}
							</Button>
						</div>
					) : null}
					<div className="flex items-center justify-between p-3 border-b">
						<h3 className="font-medium text-sm">
							{isExporting ? "Exporting project" : "Export project"}
						</h3>
					</div>

					<div className="flex flex-col gap-4">
						{!isExporting && (
							<>
								<div className="flex flex-col">
									<Section
										collapsible
										defaultOpen={false}
										showTopBorder={false}
									>
										<SectionHeader>
											<SectionTitle>Format</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={format}
												onValueChange={(value) => {
													if (isExportFormat(value)) {
														setFormat(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="mp4" id="mp4" />
													<Label htmlFor="mp4">
														MP4 (H.264) - Better compatibility
													</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="webm" id="webm" />
													<Label htmlFor="webm">
														WebM (VP9) - Smaller file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>Quality</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<RadioGroup
												value={quality}
												onValueChange={(value) => {
													if (isExportQuality(value)) {
														setQuality(value);
													}
												}}
											>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="low" id="low" />
													<Label htmlFor="low">Low - Smallest file size</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="medium" id="medium" />
													<Label htmlFor="medium">Medium - Balanced</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="high" id="high" />
													<Label htmlFor="high">High - Recommended</Label>
												</div>
												<div className="flex items-center space-x-2">
													<RadioGroupItem value="very_high" id="very_high" />
													<Label htmlFor="very_high">
														Very high - Largest file size
													</Label>
												</div>
											</RadioGroup>
										</SectionContent>
									</Section>

									<Section collapsible defaultOpen={false}>
										<SectionHeader>
											<SectionTitle>Audio</SectionTitle>
										</SectionHeader>
										<SectionContent>
											<div className="flex items-center space-x-2">
												<Checkbox
													id="include-audio"
													checked={shouldIncludeAudio}
													onCheckedChange={(checked) =>
														setShouldIncludeAudio(!!checked)
													}
												/>
												<Label htmlFor="include-audio">
													Include audio in export
												</Label>
											</div>
										</SectionContent>
									</Section>
								</div>

								<div className="p-3 pt-0">
									<Button onClick={handleExport} className="w-full gap-2">
										<Download className="size-4" />
										Export
									</Button>
								</div>
							</>
						)}

						{isExporting && (
							<div className="space-y-4 p-3">
								<div className="flex flex-col gap-2">
									<div className="flex items-center justify-between text-center">
										<p className="text-muted-foreground text-sm">
											{Math.round(progress * 100)}%
										</p>
										<p className="text-muted-foreground text-sm">100%</p>
									</div>
									<Progress value={progress * 100} className="w-full" />
								</div>

								<Button
									variant="outline"
									className="w-full rounded-md"
									onClick={handleCancel}
								>
									Cancel
								</Button>
							</div>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(error);
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="space-y-4 p-3">
			<div className="flex flex-col gap-1.5">
				<p className="text-destructive text-sm font-medium">Export failed</p>
				<p className="text-muted-foreground text-xs">{error}</p>
			</div>

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={handleCopy}
				>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					Copy
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-8 flex-1 text-xs"
					onClick={onRetry}
				>
					<RotateCcw />
					Retry
				</Button>
			</div>
		</div>
	);
}
