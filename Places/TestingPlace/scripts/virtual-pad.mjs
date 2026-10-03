// The virtual-pad service (tools/virtual-pad) for a run: a local HTTP service that plugs a virtual
// Xbox 360 pad into Windows through the ViGEmBus driver, for the tests' gamepad input
// (src/client/tests/virtual-pad.ts), which Roblox's VirtualInput can't send. `bun run test`
// starts it before the projects run and stops it after them, pass or fail. It is built with
// `cargo build --release` when its binary is missing or older than its sources. Without cargo, or
// with a service that won't start, the run warns and goes on, and the gamepad tests skip.
//
// The service also stops by itself when this script's process ends (its stdin, a pipe from here,
// closes; and it watches its parent), and unplugs its pad when it stops.
//
// Pad input is opt-in: the service refuses any pad state but the neutral one (and touch injection)
// unless it is started with --allow-input, which this script passes only when the environment
// variable VIRTUAL_PAD_INPUT=1 is set. While Steam's "Enable Steam Input for Xbox controllers" is
// on, Steam turns the pad's buttons and sticks into keys and mouse input for whatever window is
// focused: turn it off (or exit Steam) before setting it. Without it, the tests that press the pad
// skip with that reason; plugging the pad in still works.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The port the place's fixture calls (src/shared/fixtures/virtual-pad.ts) */
export const VIRTUAL_PAD_PORT = 47110;

const CRATE = "tools/virtual-pad";
const BINARY = join(CRATE, "target", "release", "virtual-pad.exe");
const URL = `http://127.0.0.1:${VIRTUAL_PAD_PORT}`;

/** How long the service may take to answer once started, and to stop once asked */
const START_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;

/** Whether this run lets the tests press the pad: VIRTUAL_PAD_INPUT=1 */
const ALLOW_INPUT = process.env.VIRTUAL_PAD_INPUT === "1";

/** The newest modification time among the crate's sources (Cargo.toml, Cargo.lock, src/) */
function newestSource() {
	let newest = 0;
	const visit = (path) => {
		const stats = statSync(path);
		if (stats.isDirectory()) for (const entry of readdirSync(path)) visit(join(path, entry));
		else newest = Math.max(newest, stats.mtimeMs);
	};
	for (const path of ["Cargo.toml", "Cargo.lock", "src"]) {
		if (existsSync(join(CRATE, path))) visit(join(CRATE, path));
	}
	return newest;
}

/** The service's /health, or undefined when nothing answers */
async function health() {
	try {
		const response = await fetch(`${URL}/health`, { signal: AbortSignal.timeout(1_000) });
		const body = await response.json();
		return body?.service === "virtual-pad" ? body : undefined;
	} catch {
		return undefined;
	}
}

/** Builds the binary if it is missing or older than its sources; false when it can't be had */
function build() {
	if (existsSync(BINARY) && statSync(BINARY).mtimeMs >= newestSource()) return true;
	console.log("building the virtual-pad service (cargo build --release)...");
	try {
		const result = Bun.spawnSync(["cargo", "build", "--release"], {
			cwd: CRATE,
			stdio: ["ignore", "inherit", "inherit"],
		});
		if (result.exitCode === 0) return true;
		console.error(`warning: cargo build failed (exit ${result.exitCode})`);
	} catch {
		console.error("warning: cargo not found on PATH");
	}
	return existsSync(BINARY);
}

/**
 * Starts the service, or finds one already running. Resolves with something to `stop()` after
 * the run, or undefined (with a warning) when there is no service: the gamepad tests then skip.
 */
export async function startVirtualPad() {
	if (process.platform !== "win32") return undefined;
	const running = await health();
	if (running !== undefined) {
		const input = running.input === true ? "on" : "off";
		console.log(`using the virtual-pad service already running on ${URL} (pad input ${input})`);
		if (ALLOW_INPUT && running.input !== true) {
			console.error(
				"warning: VIRTUAL_PAD_INPUT=1, but the service already running has pad input off: stop it to let this run start one with --allow-input",
			);
		}
		return { stop: async () => {} };
	}
	if (!build()) {
		console.error("warning: no virtual-pad service for this run: the gamepad tests will skip");
		return undefined;
	}

	const args = [BINARY, "--port", String(VIRTUAL_PAD_PORT)];
	if (ALLOW_INPUT) args.push("--allow-input");
	const child = Bun.spawn(args, {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "inherit",
	});
	let exited = false;
	child.exited.then(() => (exited = true));
	const stop = async () => {
		if (exited) return;
		// Closing its stdin stops it: it lifts its touches and unplugs its pad first
		child.stdin.end();
		const timeout = new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
		await Promise.race([child.exited, timeout]);
		if (exited) return;
		child.kill();
		console.error("warning: the virtual-pad service didn't stop when asked, and was ended");
	};

	const deadline = Date.now() + START_TIMEOUT_MS;
	let answer;
	while (!exited && Date.now() < deadline && (answer = await health()) === undefined) {
		await Bun.sleep(100);
	}
	if (answer === undefined) {
		await stop();
		console.error("warning: the virtual-pad service didn't start: the gamepad tests will skip");
		return undefined;
	}
	if (answer.bus !== "ok") {
		console.error(`warning: virtual-pad: ${answer.bus}: the gamepad tests will skip`);
	}
	console.log(
		`virtual-pad service on ${URL} (${CRATE}), pad input ${ALLOW_INPUT ? "on" : "off (VIRTUAL_PAD_INPUT=1 turns it on)"}`,
	);
	return { stop };
}
