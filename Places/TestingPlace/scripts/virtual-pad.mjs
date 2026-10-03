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
// The pad is opt-in, in two steps:
// - plugging it in: the service refuses /connect unless started with --allow-plug, which this
//   script passes only when VIRTUAL_PAD=1 is set. Every process sees a plugged-in pad, the user's
//   Roblox Player too, whose UI switches to gamepad mode;
// - pressing it: the service refuses any pad state but the neutral one (and touch injection)
//   unless started with --allow-input, which this script passes only when VIRTUAL_PAD_INPUT=1 is
//   set (it implies VIRTUAL_PAD=1). While Steam's "Enable Steam Input for Xbox controllers" is on,
//   Steam turns the pad's buttons and sticks into keys and mouse input for whatever window is
//   focused: turn it off (or exit Steam) before setting it.
// Without them, the gamepad tests skip with the reason.

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
/** Whether this run lets the tests plug the pad in: VIRTUAL_PAD=1, or VIRTUAL_PAD_INPUT=1 */
const ALLOW_PLUG = ALLOW_INPUT || process.env.VIRTUAL_PAD === "1";

/** What the service lets the tests do, for the run's log */
function describeAllowed(plug, input) {
	if (input) return "plugging in and pad input on";
	if (plug) return "plugging in on, pad input off (VIRTUAL_PAD_INPUT=1 turns it on)";
	return "the pad off (VIRTUAL_PAD=1 lets tests plug it in, VIRTUAL_PAD_INPUT=1 also press it)";
}

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
		const allowed = describeAllowed(running.plug === true, running.input === true);
		console.log(`using the virtual-pad service already running on ${URL} (${allowed})`);
		if ((ALLOW_INPUT && running.input !== true) || (ALLOW_PLUG && running.plug !== true)) {
			console.error(
				"warning: the service already running allows less than VIRTUAL_PAD/VIRTUAL_PAD_INPUT ask for: stop it to let this run start one",
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
	else if (ALLOW_PLUG) args.push("--allow-plug");
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
		`virtual-pad service on ${URL} (${CRATE}), ${describeAllowed(ALLOW_PLUG, ALLOW_INPUT)}`,
	);
	return { stop };
}
