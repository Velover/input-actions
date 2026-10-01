// The tests under a Rojo project that needs Studio's device simulator, such as `touch`: Studio
// simulates a phone, so PreferredInput is Touch and VirtualInput's mouse events arrive as touch.
// `flamework-test test` has no step between opening the window and playing, so this drives the
// window itself, with the CLI's own commands:
//
//   1. `patch` makes the place under the project (`test.<project>.rbxl`);
//   2. a window left open on that file by an earlier run is closed;
//   3. Studio is started on the file, and the run waits for the window to connect;
//   4. `studio exec --realm edit` sets the device (StudioDeviceSimulatorService:SetDeviceAsync);
//   5. `studio run` runs the tests in a play session, and stops it;
//   6. the device is set back to "default", whatever happened before: a failure, a timeout or
//      Ctrl+C. The setting belongs to Studio, not to the place, so a device left set would follow
//      the user into their own windows. Only the Edit data model can set it, so a play session
//      still running (Ctrl+C stops the CLI before it stops play) is stopped first;
//   7. the window is closed by ending the process this run started (unless --keep, which leaves it
//      open, in Edit: the play session is not kept, since the device can't be set back during one).
//
// A run killed outright (a terminal closed, an orchestrator's time limit) never gets to step 6. So
// a marker file in the system temp folder records the device from just before step 4 until step 6
// has set it back, and the next run's `restoreLeftDevice` finds it, before any project runs, and
// sets the device back in a window of its own.
//
// The Studio window helpers come from flamework-test's own module (`cli/src/studio.ts`): finding
// Studio, and closing a window by the process that opened it, without the save prompt asking
// would raise. The Flamework packages are pinned exactly, so the module can't move under us.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { findStudioExe, isPlaying, runCloseScript } from "@flamework-experimental/testing/cli/src/studio.ts";

/** The device each project runs under: an id from StudioDeviceSimulatorService:GetDeviceListAsync() */
export const DEVICE_PROJECTS = { touch: "iphone_14" };

/** How long the window may take to connect, and how often it is looked for */
const CONNECT_TIMEOUT_MS = 180_000;
const CONNECT_POLL_MS = 3_000;

/** How long a play session may take to stop before the device is set back, and the polling */
const STOP_TIMEOUT_MS = 60_000;
const STOP_POLL_MS = 1_000;

/** How many times setting the device back is tried: a play session may start or stop meanwhile */
const RESTORE_ATTEMPTS = 3;

/**
 * Written just before a run sets Studio's device, removed once it is set back. The device is
 * Studio's setting, shared by every window of this user, so the marker is the user's too.
 */
const DEVICE_MARKER = join(tmpdir(), "input-actions-testing-device.json");

/**
 * flamework-test flags that take a value, and the ones passed on to `studio run`. Not `--keep`,
 * which would leave the play session running: the device can only be set back in Edit. This run
 * keeps the window open for it instead.
 */
const VALUE_FLAGS = new Set(["realm", "sections", "timeout", "original", "file", "project"]);
const RUN_FLAGS = new Set(["realm", "sections", "timeout", "list", "json"]);

/** The project's name, as flamework-test names it: the file name without `.project.json` */
export function projectName(path) {
	return basename(path)
		.replace(/\.project\.json$/i, "")
		.replace(/\.json$/i, "");
}

/** The Luau that sets the device and answers the one Studio now simulates */
function deviceScript(device) {
	return [
		'local simulator = game:GetService("StudioDeviceSimulatorService")',
		`simulator:SetDeviceAsync(${JSON.stringify(device)})`,
		"return simulator:GetDeviceAsync()",
	].join("\n");
}

/** Runs flamework-test with inherited output; resolves with its exit code */
async function cli(args) {
	const child = Bun.spawn(["flamework-test", ...args], { stdout: "inherit", stderr: "inherit" });
	return await child.exited;
}

/** Runs flamework-test quietly; resolves with its exit code and what it printed */
async function cliQuiet(args) {
	const child = Bun.spawn(["flamework-test", ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, output: `${stdout}${stderr}`.trim() };
}

/** The `studio run` flags among the arguments `bun run test` was given; `--realm both` by default */
function runFlags(args) {
	const picked = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith("--")) continue;
		const equals = arg.indexOf("=");
		const name = arg.slice(2, equals === -1 ? undefined : equals);
		const value = equals === -1 && VALUE_FLAGS.has(name) ? args[++index] : undefined;
		if (!RUN_FLAGS.has(name)) continue;
		picked.push(arg);
		if (value !== undefined) picked.push(value);
	}
	if (!picked.some((arg) => arg === "--realm" || arg.startsWith("--realm="))) picked.push("--realm", "both");
	return picked;
}

/** Removes Studio's lock beside the place once the process that wrote it has been ended */
async function removeLock(place, pid) {
	const lock = `${place}.lock`;
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			if (!existsSync(lock)) return;
			if (readFileSync(lock, "utf8").split(/\r?\n/)[0]?.trim() !== String(pid)) return;
			rmSync(lock, { force: true });
			if (!existsSync(lock)) return;
		} catch {
			// Windows may hold it a moment after the process has gone
		}
		await Bun.sleep(500);
	}
}

/** Closes the windows a target matches (the CLI's own close); false when one stays open */
function closeWindows(target, label) {
	let windows;
	try {
		windows = runCloseScript(target);
	} catch (error) {
		console.error(`could not close ${label}: ${error.message}`);
		return false;
	}
	let closed = true;
	for (const window of windows) {
		if (window.outcome === "open") {
			closed = false;
			console.error(`${label} (PID ${window.pid}) is still open${window.error ? `: ${window.error}` : ""}`);
		} else if (window.outcome !== "untouched") {
			console.log(`closed ${label} (PID ${window.pid})`);
		}
	}
	return closed;
}

/** Waits until the window of `file` is listed on the MCP proxy; false when it never is */
async function waitForWindow(file, isInterrupted) {
	const deadline = Date.now() + CONNECT_TIMEOUT_MS;
	while (!isInterrupted() && Date.now() < deadline) {
		if ((await cliQuiet(["studio", "status", "--studio", file])).code === 0) return true;
		await Bun.sleep(CONNECT_POLL_MS);
	}
	return false;
}

/** Starts Studio on a place, detached (or Windows takes Studio down with this process); its PID */
function startStudio(exe, place) {
	const child = spawn(exe, [place], { detached: true, stdio: "ignore", windowsHide: false });
	child.unref();
	return child.pid;
}

/**
 * Stops the play session of the window of `file`, when one is running, and waits until the window
 * is back in Edit. Resolves with what went wrong, or undefined when it is in Edit.
 */
async function stopPlaying(file) {
	const status = await cliQuiet(["studio", "status", "--studio", file]);
	if (status.code !== 0) return `studio status failed: ${status.output}`;
	if (!isPlaying(status.output)) return undefined;
	console.log(`stopping the play session in ${file}, to set the device back...`);
	const stopped = await cliQuiet(["studio", "stop", "--studio", file]);
	if (stopped.code !== 0) return `studio stop failed: ${stopped.output}`;
	const deadline = Date.now() + STOP_TIMEOUT_MS;
	let last = stopped.output;
	while (Date.now() < deadline) {
		const now = await cliQuiet(["studio", "status", "--studio", file]);
		last = now.output;
		if (now.code === 0 && !isPlaying(now.output)) return undefined;
		await Bun.sleep(STOP_POLL_MS);
	}
	return `the play session did not stop within ${STOP_TIMEOUT_MS / 1000} s: ${last}`;
}

/**
 * Sets the device back to "default" in the window of `file`, and removes the marker once Studio
 * answers that it is. Only the Edit data model has the simulator, so a play session still running
 * (`studio run` cut short by Ctrl+C) is stopped first. Resolves with whether it did, and what the
 * last call printed.
 */
async function setDeviceBack(file) {
	let output = "";
	for (let attempt = 0; attempt < RESTORE_ATTEMPTS; attempt++) {
		const problem = await stopPlaying(file);
		if (problem !== undefined) {
			output = problem;
			continue;
		}
		const restored = await cliQuiet([
			"studio", "exec", "--studio", file, "--realm", "edit", "--code", deviceScript("default"),
		]);
		output = restored.output;
		if (restored.code === 0 && restored.output.includes("default")) {
			rmSync(DEVICE_MARKER, { force: true });
			return { ok: true, output };
		}
	}
	return { ok: false, output };
}

/** Says, after `heading`, how to set the device back by hand */
function restoreByHand(heading) {
	console.error(
		`\n${heading}\n` +
			"Set it back by hand: in any open Studio window's command bar, run\n" +
			'  game:GetService("StudioDeviceSimulatorService"):SetDeviceAsync("default")\n' +
			`then delete ${DEVICE_MARKER} (Places/TestingPlace/CLAUDE.md, "The touch pass").`,
	);
}

/**
 * Sets Studio's device back when an earlier run set it and ended before it could set it back (the
 * marker is still there): a window of its own on a copy of `built`, set back there, then closed.
 * Resolves with false when the device may still be set, so the projects would run on a simulated
 * phone.
 */
export async function restoreLeftDevice(built) {
	if (!existsSync(DEVICE_MARKER)) return true;
	let left = "a device";
	try {
		left = JSON.parse(readFileSync(DEVICE_MARKER, "utf8")).device ?? left;
	} catch {
		// An unreadable marker still means a run never set the device back
	}
	console.log(
		`\nan earlier run set Studio's device to ${left} and ended before it set it back ` +
			`(${DEVICE_MARKER} is still there); setting it back first...`,
	);
	const exe = findStudioExe();
	if (exe === undefined) {
		restoreByHand(`RobloxStudioBeta.exe was not found (set ROBLOX_STUDIO_EXE): STUDIO MAY STILL SIMULATE ${left}.`);
		return false;
	}
	const place = resolve(`${built.replace(/\.rbxlx?$/i, "")}.device-restore.rbxl`);
	const file = basename(place);
	if (!closeWindows({ file: place }, `the window left from an earlier run of ${file}`)) return false;
	copyFileSync(built, place);
	let pid;
	let ok = false;
	try {
		pid = startStudio(exe, place);
		console.log(`opening ${file} in Studio (PID ${pid}); waiting for it to connect...`);
		if (!(await waitForWindow(file, () => false))) {
			restoreByHand(`${file} never showed up on the MCP proxy: STUDIO MAY STILL SIMULATE ${left}.`);
		} else {
			const restored = await setDeviceBack(file);
			ok = restored.ok;
			if (ok) console.log("Studio's device is back to default");
			else restoreByHand(`STUDIO MAY STILL SIMULATE ${left}: setting it back failed (${restored.output}).`);
		}
	} finally {
		if (pid !== undefined && closeWindows({ pid, file: place }, file)) await removeLock(place, pid);
		rmSync(place, { force: true });
	}
	return ok;
}

/**
 * The tests of one device project. `built` is the place Rojo built, `original` the place it is laid
 * over, `args` what `bun run test` was given besides `--project`. Resolves with the exit code.
 */
export async function runOnDevice(projectPath, built, original, args) {
	const name = projectName(projectPath);
	const device = DEVICE_PROJECTS[name];
	console.log(`\n=== ${name}: ${projectPath}, on the simulated device ${device} ===`);

	const patched = await cli(["patch", built, "--original", original, "--project", projectPath]);
	if (patched !== 0) return patched;
	const place = resolve(`${built.replace(/\.rbxlx?$/i, "")}.${name}.rbxl`);
	const file = basename(place);
	const keep = args.includes("--keep");

	// A window left on this file by an earlier run would test stale code, and share the name
	if (!closeWindows({ file: place }, `the window left from an earlier run of ${file}`)) return 1;

	const exe = findStudioExe();
	if (exe === undefined) {
		console.error("RobloxStudioBeta.exe was not found; set ROBLOX_STUDIO_EXE");
		return 1;
	}

	// Ctrl+C reaches the CLI's processes too, which stop; this one carries on to restore the device
	let interrupted = false;
	const onInterrupt = () => {
		interrupted = true;
		console.error("\ninterrupted: setting the device back and closing the window...");
	};
	process.on("SIGINT", onInterrupt);

	let pid;
	let deviceSet = false;
	let code = 1;
	try {
		pid = startStudio(exe, place);
		console.log(`opening ${file} in Studio (PID ${pid}); waiting for it to connect...`);

		if (!(await waitForWindow(file, () => interrupted))) {
			if (!interrupted) {
				console.error(
					`${file} never showed up on the MCP proxy within ${CONNECT_TIMEOUT_MS / 1000} s: ` +
						'is "MCP server" on in Studio\'s Assistant settings?',
				);
			}
		} else {
			console.log(`connected: ${file}`);
			// Counted as set before the call: a call cut short may still have set it. The marker
			// outlives a run killed before the `finally` below sets the device back
			deviceSet = true;
			writeFileSync(DEVICE_MARKER, JSON.stringify({ device, place, pid }));
			const set = await cliQuiet(["studio", "exec", "--studio", file, "--realm", "edit", "--code", deviceScript(device)]);
			if (set.code !== 0 || !set.output.includes(device)) {
				console.error(`setting the device ${device} failed: ${set.output}`);
			} else if (!interrupted) {
				console.log(`Studio simulates ${device}`);
				code = await cli(["studio", "run", "--studio", file, ...runFlags(args)]);
			}
		}
	} finally {
		if (deviceSet) {
			const restored = await setDeviceBack(file);
			if (restored.ok) console.log("Studio's device is back to default");
			else {
				restoreByHand(`STUDIO MAY STILL SIMULATE ${device}: setting it back failed (${restored.output}).`);
				if (code === 0) code = 1;
			}
		}
		if (keep) console.log("Studio left open, in Edit (--keep; the device can only be set back there)");
		else if (pid !== undefined && closeWindows({ pid, file: place }, file)) await removeLock(place, pid);
		process.off("SIGINT", onInterrupt);
	}
	return interrupted ? 130 : code;
}
