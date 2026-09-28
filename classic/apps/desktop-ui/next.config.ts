import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const transformersNodeEntry = require.resolve("@huggingface/transformers", {
	paths: [path.resolve(process.cwd(), "../web")],
});
const transformersWebEntry = path.join(
	path.dirname(transformersNodeEntry),
	"transformers.web.js",
);

const nextConfig: NextConfig = {
	output: "export",
	trailingSlash: true,
	images: { unoptimized: true },
	reactStrictMode: true,
	serverExternalPackages: ["onnxruntime-node"],
	webpack: (config, { isServer }) => {
		config.resolve.alias = {
			...(config.resolve.alias ?? {}),
			"@huggingface/transformers": transformersWebEntry,
		};
		config.resolve.modules = [
			...(config.resolve.modules ?? []),
			path.resolve(process.cwd(), "../web/node_modules"),
			path.resolve(process.cwd(), "../../node_modules"),
		];
		config.experiments = {
			...config.experiments,
			asyncWebAssembly: true,
		};
		if (isServer) {
			config.output.webassemblyModuleFilename =
				"../static/wasm/[modulehash].wasm";
			config.plugins.push({
				apply(compiler: any) {
					compiler.hooks.afterEmit.tap("HovaCutDesktopWasm", (compilation: any) => {
						for (const asset of compilation.getAssets()) {
							if (!asset.name.endsWith(".wasm")) continue;
							const filename = path.basename(asset.name);
							const emittedPath = path.resolve(
								compiler.outputPath,
								asset.name,
							);
							if (!fs.existsSync(emittedPath)) continue;
							const bytes = fs.readFileSync(emittedPath);
							for (const directory of [
								path.resolve(process.cwd(), ".next/server/static/wasm"),
								path.resolve(process.cwd(), ".next/static/wasm"),
							]) {
								fs.mkdirSync(directory, { recursive: true });
								fs.writeFileSync(path.join(directory, filename), bytes);
							}
						}
					});
				},
			});
		}
		return config;
	},
};

export default nextConfig;
