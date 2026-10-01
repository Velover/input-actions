// `bun run test`: builds with the testing scope, runs the tests in Studio, then rebuilds with no
// scope whatever happened, so out/ never keeps a build that hosts the tests (guide 12, "Setting
// up"). Start it with `bun run test`, which puts node_modules/.bin on the PATH; run on its own,
// `bun scripts/test.mjs` finds no rbxtsc, or a global one instead of the project's. Extra
// arguments go to flamework-test, as in `bun run test --sections levels`. A project that needs
// Studio's device simulator (`--project tests/touch.project.json`) runs through
// scripts/device-test.mjs instead, after the others.

import { DEVICE_PROJECTS, projectName, runOnDevice } from "./device-test.mjs";

/**
 * The `--project` values among the arguments (repeated or comma-separated, `--project x` or
 * `--project=x`), and the other arguments as they are.
 */
function splitProjects(args) {
	const projects = [];
	const rest = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		let value;
		if (arg === "--project") value = args[++index] ?? "";
		else if (arg.startsWith("--project=")) value = arg.slice("--project=".length);
		else {
			rest.push(arg);
			continue;
		}
		for (const entry of value.split(",")) if (entry.trim() !== "") projects.push(entry.trim());
	}
	return { projects, rest };
}

/** Runs a command in the terminal. Returns its exit code, or undefined when it can't be started. */
function run(command, env = process.env) {
	try {
		return Bun.spawnSync(command, { env, stdio: ["inherit", "inherit", "inherit"] }).exitCode ?? 1;
	} catch (error) {
		// Bun throws, rather than returning a code, for a command it cannot start.
		const why =
			error.code === "ENOENT" ? "not found on PATH" : `could not be started (${error.message})`;
		console.error(`\n${command[0]} ${why}`);
		return undefined;
	}
}

// The package under test, built from the repository root and copied into node_modules. Nothing
// else has run yet, so a failure here leaves out/ as it was.
const linked = run(["bun", "scripts/link-package.mjs"]);
if (linked !== 0) process.exit(linked ?? 127);

// The compile-time rules (tests/type-rules): plain tsc, since roblox-ts refuses @ts-expect-error.
// A rule that stops holding leaves its directive unused, and the run stops here.
const typeRules = run(["tsc", "-p", "tests/type-rules"]);
if (typeRules !== 0) {
	console.error("the compile-time rules in tests/type-rules failed");
	process.exit(typeRules ?? 127);
}

let code = run(["rbxtsc"], { ...process.env, FLAMEWORK_SCOPES: "testing" });
if (code === undefined) {
	console.error(
		"Nothing was built, and there is no rbxtsc to rebuild out/ with. Start the tests with " +
			"`bun run test`, and run `bun install` if rbxtsc is still not found.",
	);
	process.exit(127);
}
// test.rbxl, not place.rbxl: the place `bun run place` builds never holds the tests.
if (code === 0) code = run(["rojo", "build", "-o", "test.rbxl"]) ?? 127;
if (code === 0) {
	// Projects that need Studio's device simulator (`touch`) run through scripts/device-test.mjs,
	// after the others, which flamework-test runs as they are
	const { projects, rest } = splitProjects(process.argv.slice(2));
	const onDevice = projects.filter((project) => projectName(project) in DEVICE_PROJECTS);
	const plain = projects.filter((project) => !onDevice.includes(project));
	if (plain.length > 0 || onDevice.length === 0) {
		const projectArgs = plain.length > 0 ? ["--project", plain.join(",")] : [];
		const args = ["test", "test.rbxl", "--original", "tests/place.rbxlx", ...projectArgs, ...rest];
		code = run(["flamework-test", ...args]) ?? 127;
	}
	const outcomes = [];
	for (const project of onDevice) {
		const deviceCode = await runOnDevice(project, "test.rbxl", "tests/place.rbxlx", rest);
		outcomes.push(`${projectName(project)} ${deviceCode === 0 ? "passed" : "FAILED"}`);
		code = Math.max(code, deviceCode);
		// Ctrl+C: the device was set back and the window closed; the rest is skipped
		if (deviceCode === 130) break;
	}
	if (outcomes.length > 0) console.log(`\nprojects on a simulated device: ${outcomes.join(", ")}`);
}

// The scope is set to nothing rather than left out, so that a scope in .env.local, or one exported
// in the shell, cannot come back through this build.
console.log("rebuilding out/ without the testing scope...");
const rebuild = run(["rbxtsc"], { ...process.env, FLAMEWORK_SCOPES: "" }) ?? 127;
if (rebuild !== 0) {
	console.error(
		"The rebuild failed, so out/ may still hold the testing build: run `bun run build`.",
	);
}
process.exit(code !== 0 ? code : rebuild);
