// Builds @rbxts/input-actions from the repository root and copies it into this place's
// node_modules, the way a published install would lay it out: out/, package.json and
// default.project.json. `bun run test` runs it first, so the tests always see the current source.
// Run it on its own with `bun run link`.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const placeRoot = resolve(import.meta.dir, "..");
const packageRoot = resolve(placeRoot, "..", "..");
const target = join(placeRoot, "node_modules", "@rbxts", "input-actions");

// A clean build: roblox-ts leaves the output of deleted source files behind.
rmSync(join(packageRoot, "out"), { recursive: true, force: true });
const build = Bun.spawnSync(["bun", "x", "rbxtsc"], {
	cwd: packageRoot,
	stdio: ["inherit", "inherit", "inherit"],
});
if (build.exitCode !== 0) {
	console.error(`building the package failed (exit ${build.exitCode})`);
	process.exit(build.exitCode ?? 1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(packageRoot, "out"), join(target, "out"), {
	recursive: true,
	filter: (source) => !source.endsWith(".tsbuildinfo"),
});
for (const file of ["package.json", "default.project.json"]) {
	if (existsSync(join(packageRoot, file))) cpSync(join(packageRoot, file), join(target, file));
}
console.log(`linked @rbxts/input-actions into ${target}`);
