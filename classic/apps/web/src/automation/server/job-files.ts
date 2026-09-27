import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

export async function withJobDirectory<T>({ prefix, run }: { prefix: string; run: (directory: string) => Promise<T> }): Promise<T> {
	const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
	try {
		return await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export async function saveUpload({ file, directory, index = 0 }: { file: File; directory: string; index?: number }) {
	const extension = path.extname(file.name).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10) || ".bin";
	const target = path.join(directory, `input-${index}${extension}`);
	await writeFile(target, Buffer.from(await file.arrayBuffer()));
	return target;
}

export async function fileResponse({ path: filePath, contentType, filename }: { path: string; contentType: string; filename: string }) {
	const output = await readFile(filePath);
	return new Response(output, {
		headers: {
			"Content-Type": contentType,
			"Content-Disposition": `attachment; filename="${filename}"`,
			"Cache-Control": "no-store",
		},
	});
}
