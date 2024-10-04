import { defineConfig } from "tsup";

export default defineConfig({
	bundle: false,
	clean: true,
	entry: ["src/**/*.ts"],
	format: "esm",
	outDir: "run",
});
