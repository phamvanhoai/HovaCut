import type { TProject, TProjectMetadata } from "@/project/types";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { MediaAsset } from "@/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	MediaAssetData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import type { SavedSoundsData, SavedSound, SoundEffect } from "@/sounds/types";
import {
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { roundMediaTime } from "@/wasm";
import { getMimeTypeFromName } from "@/media/media-utils";

type DesktopWindow = Window & {
	__TAURI__?: {
		core: {
			invoke: <T>(
				command: string,
				args?: Record<string, unknown>,
			) => Promise<T>;
			convertFileSrc?: (path: string) => string;
		};
	};
};

function desktopInvoke<T>({
	command,
	args,
}: {
	command: string;
	args: Record<string, unknown>;
}) {
	if (typeof window === "undefined") return null;
	return (
		(window as DesktopWindow).__TAURI__?.core.invoke<T>(command, args) ?? null
	);
}

function hasDesktopStorage(): boolean {
	return (
		typeof window !== "undefined" &&
		Boolean((window as DesktopWindow).__TAURI__?.core.invoke)
	);
}

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			const obj = item as Record<string, unknown>;
			if (
				typeof obj !== "object" ||
				obj === null ||
				typeof obj.time !== "number"
			) {
				return null;
			}
			return {
				time: roundMediaTime({ time: obj.time }),
				...(typeof obj.note === "string" && { note: obj.note }),
				...(typeof obj.color === "string" && { color: obj.color }),
				...(typeof obj.duration === "number" && {
					duration: roundMediaTime({ time: obj.duration }),
				}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private savedSoundsAdapter: IndexedDBAdapter<SavedSoundsData>;
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			savedSoundsDb: "video-editor-saved-sounds",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});

		this.savedSoundsAdapter = new IndexedDBAdapter<SavedSoundsData>({
			dbName: this.config.savedSoundsDb,
			storeName: "saved-sounds",
			version: this.config.version,
		});
	}

	private async ensureMigrations(): Promise<void> {
		if (hasDesktopStorage()) return;
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		const mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);

		return { mediaMetadataAdapter, mediaAssetsAdapter };
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}

	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serializedProject: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
		};

		if (hasDesktopStorage()) {
			await desktopInvoke({
				command: "save_project_json",
				args: { projectId: project.metadata.id, project: serializedProject },
			});
		} else {
			await this.projectsAdapter.set({
				key: project.metadata.id,
				value: serializedProject,
			});
		}
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		await this.ensureMigrations();
		let serializedProject: SerializedProject | null;
		if (hasDesktopStorage()) {
			serializedProject = await desktopInvoke<SerializedProject | null>({
					command: "load_project_json",
					args: { projectId: id },
				});
		} else {
			serializedProject = await this.projectsAdapter.get(id);
		}

		if (!serializedProject) return null;

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const scenes =
			serializedProject.scenes?.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				tracks: scene.tracks,
				bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
				createdAt: new Date(scene.createdAt),
				updatedAt: new Date(scene.updatedAt),
			})) ?? [];

		const project: TProject = {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
		};

		return { project };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = hasDesktopStorage()
			? (
					(await desktopInvoke<SerializedProject[]>({
						command: "list_project_jsons",
						args: {},
					})) ?? []
				).map((project) => project.metadata.id)
			: await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = hasDesktopStorage()
			? ((await desktopInvoke<SerializedProject[]>({
					command: "list_project_jsons",
					args: {},
				})) ?? [])
			: await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: (serializedProject.scenes ?? []) as unknown as TScene[],
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			});
		}

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		if (hasDesktopStorage()) {
			await desktopInvoke({
				command: "delete_project_json",
				args: { projectId: id },
			});
		} else {
			await this.projectsAdapter.remove(id);
		}
	}

	async importDesktopProject({
		inputPath,
	}: {
		inputPath: string;
	}): Promise<string> {
		const serializedProject = await desktopInvoke<
			SerializedProject & { desktopMedia?: MediaAssetData[] }
		>({
			command: "import_project_json",
			args: { inputPath },
		});
		if (!serializedProject?.metadata?.id) {
			throw new Error("File project không hợp lệ.");
		}
		if (!hasDesktopStorage()) {
			await this.projectsAdapter.set({
				key: serializedProject.metadata.id,
				value: serializedProject,
			});
		}
		if (serializedProject.desktopMedia?.length) {
			if (hasDesktopStorage()) {
				await Promise.all(
					serializedProject.desktopMedia.map((metadata) =>
						desktopInvoke({
							command: "save_media_metadata",
							args: {
								projectId: serializedProject.metadata.id,
								metadata,
							},
						}),
					),
				);
			} else {
				const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
					projectId: serializedProject.metadata.id,
				});
				await Promise.all(
					serializedProject.desktopMedia.map((metadata) =>
						mediaMetadataAdapter.set({ key: metadata.id, value: metadata }),
					),
				);
			}
		}
		return serializedProject.metadata.id;
	}

	async exportDesktopProject({
		id,
		outputPath,
	}: {
		id: string;
		outputPath: string;
	}): Promise<void> {
		const mediaAssets = hasDesktopStorage()
			? ((await desktopInvoke<MediaAssetData[]>({
					command: "list_media_metadata",
					args: { projectId: id },
				})) ?? [])
			: await this.getProjectMediaAdapters({
					projectId: id,
				}).mediaMetadataAdapter.getAll();
		await desktopInvoke({
			command: "export_project_json",
			args: { projectId: id, outputPath, mediaAssets },
		});
	}

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata: MediaAssetData = {
			id: mediaAsset.id,
			name: mediaAsset.name,
			type: mediaAsset.type,
			size: mediaAsset.file.size,
			lastModified: mediaAsset.file.lastModified,
			mimeType: mediaAsset.file.type,
			sourcePath: mediaAsset.sourcePath,
			width: mediaAsset.width,
			height: mediaAsset.height,
			duration: mediaAsset.duration,
			thumbnailUrl: mediaAsset.thumbnailUrl,
			ephemeral: mediaAsset.ephemeral,
		};

		try {
			if (!mediaAsset.sourcePath) {
				if (hasDesktopStorage()) {
					await desktopInvoke({
						command: "save_media_file",
						args: {
							projectId,
							mediaId: mediaAsset.id,
							data: Array.from(new Uint8Array(await mediaAsset.file.arrayBuffer())),
						},
					});
				} else {
					await mediaAssetsAdapter.set({
						key: mediaAsset.id,
						value: mediaAsset.file,
					});
				}
			}
			if (hasDesktopStorage()) {
				await desktopInvoke({
					command: "save_media_metadata",
					args: { projectId, metadata },
				});
			} else {
				await mediaMetadataAdapter.set({
					key: mediaAsset.id,
					value: metadata,
				});
			}
		} catch (error) {
			try {
				await mediaAssetsAdapter.remove(mediaAsset.id);
			} catch {
				// Ignore cleanup failures so the original storage error is preserved.
			}

			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({
					requiredBytes: mediaAsset.file.size,
				});
			}

			throw error;
		}
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata = hasDesktopStorage()
			? await desktopInvoke<MediaAssetData | null>({
					command: "load_media_metadata",
					args: { projectId, mediaId: id },
				})
			: await mediaMetadataAdapter.get(id);
		let storedFile: File | null = null;
		if (metadata && !metadata.sourcePath) {
			if (hasDesktopStorage()) {
				const data = await desktopInvoke<number[] | null>({
					command: "load_media_file",
					args: { projectId, mediaId: id },
				});
				if (data) {
					storedFile = new File([new Uint8Array(data)], metadata.name, {
						type:
							metadata.mimeType || getMimeTypeFromName({ name: metadata.name }),
						lastModified: metadata.lastModified,
					});
				}
			} else {
				storedFile = await mediaAssetsAdapter.get(id);
			}
		}

		if (!metadata) return null;
		let file = storedFile;
		let nativeUrl: string | undefined;
		if (!file && metadata.sourcePath && typeof window !== "undefined") {
			nativeUrl = (window as DesktopWindow).__TAURI__?.core.convertFileSrc?.(
				metadata.sourcePath,
			);
			if (nativeUrl) {
				file = new File([], metadata.name, {
					type:
						metadata.mimeType || getMimeTypeFromName({ name: metadata.name }),
					lastModified: metadata.lastModified,
				});
			}
		}
		if (!file) return null;

		let url: string;
		if (nativeUrl) {
			url = nativeUrl;
		} else if (metadata.type === "image" && (!file.type || file.type === "")) {
			try {
				const text = await file.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(file);
				}
			} catch {
				url = URL.createObjectURL(file);
			}
		} else {
			url = URL.createObjectURL(file);
		}

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file,
			sourcePath: metadata.sourcePath,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
		};
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		const mediaIds = hasDesktopStorage()
			? (
					(await desktopInvoke<MediaAssetData[]>({
						command: "list_media_metadata",
						args: { projectId },
					})) ?? []
				).map((metadata) => metadata.id)
			: await this.getProjectMediaAdapters({
					projectId,
				}).mediaMetadataAdapter.list();
		const mediaItems: MediaAsset[] = [];

		for (const id of mediaIds) {
			const item = await this.loadMediaAsset({ projectId, id });
			if (item) {
				mediaItems.push(item);
			}
		}

		return mediaItems;
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		if (hasDesktopStorage()) {
			await Promise.all([
				desktopInvoke({
					command: "delete_media_file",
					args: { projectId, mediaId: id },
				}),
				desktopInvoke({
					command: "delete_media_metadata",
					args: { projectId, mediaId: id },
				}),
			]);
		} else {
			await Promise.all([
				mediaAssetsAdapter.remove(id),
				mediaMetadataAdapter.remove(id),
			]);
		}
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		if (hasDesktopStorage()) {
			await Promise.all([
				desktopInvoke({
					command: "clear_project_media_files",
					args: { projectId },
				}),
				desktopInvoke({
					command: "clear_media_metadata",
					args: { projectId },
				}),
			]);
		} else {
			await Promise.all([
				mediaAssetsAdapter.clear(),
				mediaMetadataAdapter.clear(),
			]);
		}
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = hasDesktopStorage()
			? (
					(await desktopInvoke<SerializedProject[]>({
						command: "list_project_jsons",
						args: {},
					})) ?? []
				).map((project) => project.metadata.id)
			: await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const mediaIds = hasDesktopStorage()
			? (
					(await desktopInvoke<MediaAssetData[]>({
						command: "list_media_metadata",
						args: { projectId },
					})) ?? []
				).map((metadata) => metadata.id)
			: await this.getProjectMediaAdapters({
					projectId,
				}).mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	async loadSavedSounds(): Promise<SavedSoundsData> {
		try {
			const savedSoundsData = hasDesktopStorage()
				? await desktopInvoke<SavedSoundsData | null>({
						command: "load_saved_sounds_json",
						args: {},
					})
				: await this.savedSoundsAdapter.get("user-sounds");
			return (
				savedSoundsData || {
					sounds: [],
					lastModified: new Date().toISOString(),
				}
			);
		} catch (error) {
			console.error("Failed to load saved sounds:", error);
			return { sounds: [], lastModified: new Date().toISOString() };
		}
	}

	async saveSoundEffect({
		soundEffect,
	}: {
		soundEffect: SoundEffect;
	}): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			if (currentData.sounds.some((sound) => sound.id === soundEffect.id)) {
				return; // Already saved
			}

			const savedSound: SavedSound = {
				id: soundEffect.id,
				name: soundEffect.name,
				username: soundEffect.username,
				previewUrl: soundEffect.previewUrl,
				downloadUrl: soundEffect.downloadUrl,
				duration: soundEffect.duration,
				tags: soundEffect.tags,
				license: soundEffect.license,
				savedAt: new Date().toISOString(),
			};

			const updatedData: SavedSoundsData = {
				sounds: [...currentData.sounds, savedSound],
				lastModified: new Date().toISOString(),
			};

			if (hasDesktopStorage()) {
				await desktopInvoke({
					command: "save_saved_sounds_json",
					args: { data: updatedData },
				});
			} else {
				await this.savedSoundsAdapter.set({
					key: "user-sounds",
					value: updatedData,
				});
			}
		} catch (error) {
			console.error("Failed to save sound effect:", error);
			throw error;
		}
	}

	async removeSavedSound({ soundId }: { soundId: number }): Promise<void> {
		try {
			const currentData = await this.loadSavedSounds();

			const updatedData: SavedSoundsData = {
				sounds: currentData.sounds.filter((sound) => sound.id !== soundId),
				lastModified: new Date().toISOString(),
			};

			if (hasDesktopStorage()) {
				await desktopInvoke({
					command: "save_saved_sounds_json",
					args: { data: updatedData },
				});
			} else {
				await this.savedSoundsAdapter.set({
					key: "user-sounds",
					value: updatedData,
				});
			}
		} catch (error) {
			console.error("Failed to remove saved sound:", error);
			throw error;
		}
	}

	async isSoundSaved({ soundId }: { soundId: number }): Promise<boolean> {
		try {
			const currentData = await this.loadSavedSounds();
			return currentData.sounds.some((sound) => sound.id === soundId);
		} catch (error) {
			console.error("Failed to check if sound is saved:", error);
			return false;
		}
	}

	async clearSavedSounds(): Promise<void> {
		try {
			if (hasDesktopStorage()) {
				await desktopInvoke({
					command: "clear_saved_sounds_json",
					args: {},
				});
			} else {
				await this.savedSoundsAdapter.remove("user-sounds");
			}
		} catch (error) {
			console.error("Failed to clear saved sounds:", error);
			throw error;
		}
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported() && this.isOPFSSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };
