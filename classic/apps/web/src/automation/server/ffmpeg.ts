import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { FfmpegStatus } from "../types";

const AUTOMATION_ENABLED = process.env.HOVACUT_ENABLE_LOCAL_AUTOMATION === "true";

export function resolveFfmpegPath(): string {
	const configured = process.env.HOVACUT_FFMPEG_PATH?.trim();
	if (configured) return configured;

	return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function execute({ executable, args }: { executable: string; args: string[] }) {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(executable, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) return resolve({ stdout, stderr });
			reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
		});
	});
}

export async function getFfmpegStatus(): Promise<FfmpegStatus> {
	if (!AUTOMATION_ENABLED) {
		return {
			enabled: false,
			available: false,
			path: null,
			version: null,
			error: "Local automation is disabled.",
		};
	}

	const executable = resolveFfmpegPath();
	try {
		if (path.isAbsolute(executable)) await access(executable);
		const { stdout } = await execute({ executable, args: ["-version"] });
		return {
			enabled: true,
			available: true,
			path: executable,
			version: stdout.split(/\r?\n/, 1)[0] || "FFmpeg",
		};
	} catch (error) {
		return {
			enabled: true,
			available: false,
			path: executable,
			version: null,
			error: error instanceof Error ? error.message : "FFmpeg is unavailable.",
		};
	}
}

export async function runFfmpeg({ args }: { args: string[] }) {
	if (!AUTOMATION_ENABLED) throw new Error("Local automation is disabled.");
	return execute({ executable: resolveFfmpegPath(), args });
}
