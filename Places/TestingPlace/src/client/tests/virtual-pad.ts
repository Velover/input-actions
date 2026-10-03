import { defer } from "@flamework-experimental/testing";
import { ReplicatedStorage, UserInputService } from "@rbxts/services";
import {
	VIRTUAL_PAD_REMOTE,
	VirtualPadMethod,
	VirtualPadPath,
	VirtualPadReply,
	VirtualPadState,
} from "shared/fixtures/virtual-pad";
import { frames } from "./helpers";

// Real gamepad input: a virtual Xbox 360 pad that the virtual-pad service (tools/virtual-pad,
// started by `bun run test`) plugs into Windows, which VirtualInput can't do (it sends gamepad
// KeyCodes as keyboard input). HttpService works on the server only, so every call goes through
// the server's host (src/server/tests/virtual-pad.ts). A test plugs the pad in with `Connect`; when
// the test ends, pass or fail, everything it holds is released and the pad unplugged: a pad left
// plugged in would make every later test see a gamepad.

/** The buttons, by the KeyCode Roblox reports for them, and the service's names */
const BUTTONS = new ReadonlyMap<Enum.KeyCode, string>([
	[Enum.KeyCode.ButtonA, "A"],
	[Enum.KeyCode.ButtonB, "B"],
	[Enum.KeyCode.ButtonX, "X"],
	[Enum.KeyCode.ButtonY, "Y"],
	[Enum.KeyCode.ButtonL1, "LB"],
	[Enum.KeyCode.ButtonR1, "RB"],
	[Enum.KeyCode.ButtonSelect, "Back"],
	[Enum.KeyCode.ButtonStart, "Start"],
	[Enum.KeyCode.ButtonL3, "LeftThumb"],
	[Enum.KeyCode.ButtonR3, "RightThumb"],
	[Enum.KeyCode.DPadUp, "DPadUp"],
	[Enum.KeyCode.DPadDown, "DPadDown"],
	[Enum.KeyCode.DPadLeft, "DPadLeft"],
	[Enum.KeyCode.DPadRight, "DPadRight"],
]);

/** A button of the pad, by its KeyCode. The triggers (ButtonL2, ButtonR2) go through `SetTrigger`. */
export type PadButton =
	| Enum.KeyCode.ButtonA
	| Enum.KeyCode.ButtonB
	| Enum.KeyCode.ButtonX
	| Enum.KeyCode.ButtonY
	| Enum.KeyCode.ButtonL1
	| Enum.KeyCode.ButtonR1
	| Enum.KeyCode.ButtonSelect
	| Enum.KeyCode.ButtonStart
	| Enum.KeyCode.ButtonL3
	| Enum.KeyCode.ButtonR3
	| Enum.KeyCode.DPadUp
	| Enum.KeyCode.DPadDown
	| Enum.KeyCode.DPadLeft
	| Enum.KeyCode.DPadRight;
export type PadStick = Enum.KeyCode.Thumbstick1 | Enum.KeyCode.Thumbstick2;
export type PadTrigger = Enum.KeyCode.ButtonL2 | Enum.KeyCode.ButtonR2;

/** How long Roblox may take to list a gamepad plugged in, or to drop one unplugged (seconds) */
const GAMEPAD_TIMEOUT = 5;

/** Calls the service through the server's host */
export function callVirtualPad(
	method: VirtualPadMethod,
	path: VirtualPadPath,
	body?: object,
): VirtualPadReply {
	const remote = ReplicatedStorage.WaitForChild(VIRTUAL_PAD_REMOTE, 10) as
		RemoteFunction | undefined;
	if (remote === undefined) return { Ok: false, Error: `the server has no ${VIRTUAL_PAD_REMOTE}` };
	return remote.InvokeServer(method, path, body) as VirtualPadReply;
}

/** Waits until `done` holds or `timeout` seconds pass; whether it held */
function waitUntil(done: () => boolean, timeout = GAMEPAD_TIMEOUT) {
	const deadline = os.clock() + timeout;
	while (!done()) {
		if (os.clock() >= deadline) return false;
		task.wait();
	}
	return true;
}

/**
 * The virtual pad, for one test. Each change sends the pad's whole state. Buttons held, triggers
 * and sticks are released when the test ends, given two frames to land, and the pad is unplugged.
 */
export class VirtualPad {
	/** The gamepad Roblox listed when `Connect` plugged the pad in */
	Gamepad?: Enum.UserInputType;
	private _connected = false;
	private readonly _buttons = new Set<PadButton>();
	private readonly _triggers = new Map<PadTrigger, number>();
	private readonly _sticks = new Map<PadStick, Vector2>();

	constructor() {
		defer(() => this.Cleanup());
	}

	/**
	 * Plugs the pad in, at the neutral state, and waits for Roblox to list a new gamepad. Returns
	 * that gamepad (`Gamepad1`...), or undefined when Roblox never listed one (for the test to
	 * skip). Throws when the service fails.
	 */
	Connect(): Enum.UserInputType | undefined {
		const before = new Set(UserInputService.GetConnectedGamepads());
		this.Request("POST", "/connect");
		this._connected = true;
		waitUntil(() => {
			this.Gamepad = UserInputService.GetConnectedGamepads().find((pad) => !before.has(pad));
			return this.Gamepad !== undefined;
		});
		return this.Gamepad;
	}

	/** Releases everything and unplugs the pad, then waits for Roblox to drop its gamepad */
	Disconnect() {
		if (!this._connected) return;
		this.Clear();
		this.Request("POST", "/disconnect");
		this._connected = false;
		const gamepad = this.Gamepad;
		this.Gamepad = undefined;
		if (gamepad !== undefined) waitUntil(() => !UserInputService.GetGamepadConnected(gamepad));
	}

	Press(button: PadButton) {
		if (this._buttons.has(button)) error(`${button.Name} is already held`, 2);
		this._buttons.add(button);
		this.Send();
	}

	Release(button: PadButton) {
		if (!this._buttons.delete(button)) return;
		this.Send();
	}

	/** Presses and releases a button, a few frames apart */
	Tap(button: PadButton) {
		this.Press(button);
		frames(2);
		this.Release(button);
		frames(2);
	}

	/** Moves a stick: each axis -1 to 1, y up (as XInput has it) */
	SetStick(stick: PadStick, position: Vector2) {
		this._sticks.set(stick, position);
		this.Send();
	}

	/** Pulls a trigger: 0 (released) to 1 (all the way) */
	SetTrigger(trigger: PadTrigger, value: number) {
		this._triggers.set(trigger, value);
		this.Send();
	}

	/** Releases every button, trigger and stick */
	Reset() {
		this.Clear();
		this.Request("POST", "/reset");
	}

	private Clear() {
		this._buttons.clear();
		this._triggers.clear();
		this._sticks.clear();
	}

	private State(): VirtualPadState {
		const buttons = new Array<string>();
		for (const button of this._buttons) buttons.push(BUTTONS.get(button)!);
		const left = this._sticks.get(Enum.KeyCode.Thumbstick1) ?? Vector2.zero;
		const right = this._sticks.get(Enum.KeyCode.Thumbstick2) ?? Vector2.zero;
		return {
			buttons,
			leftTrigger: this._triggers.get(Enum.KeyCode.ButtonL2) ?? 0,
			rightTrigger: this._triggers.get(Enum.KeyCode.ButtonR2) ?? 0,
			leftStick: [left.X, left.Y],
			rightStick: [right.X, right.Y],
		};
	}

	private Send() {
		if (!this._connected) error("the virtual pad is not plugged in: call Connect first", 3);
		this.Request("POST", "/state", this.State());
	}

	private Request(method: VirtualPadMethod, path: VirtualPadPath, body?: object) {
		const reply = callVirtualPad(method, path, body);
		if (!reply.Ok) error(`virtual-pad ${method} ${path}: ${reply.Error}`, 3);
		return reply.Body;
	}

	/** At the end of the test: releases what is held, lets the release land, and unplugs the pad */
	private Cleanup() {
		if (!this._connected) return;
		const held = this._buttons.size() > 0 || this._triggers.size() > 0 || this._sticks.size() > 0;
		this.Clear();
		pcall(() => callVirtualPad("POST", "/reset"));
		if (held) frames(2);
		pcall(() => this.Disconnect());
	}
}

/** Why a gamepad test skips when the service may not plug the pad in (the default) */
export const PAD_OFF =
	"the virtual pad is off: set VIRTUAL_PAD=1 to let tests plug it in (every process sees a plugged-in pad, a Roblox Player's UI switches to gamepad mode)";

/** Why a test that presses the pad skips when the service has pad input off (the default) */
export const PAD_INPUT_OFF =
	"pad input is off: set VIRTUAL_PAD_INPUT=1 after turning off Steam Input for Xbox controllers";

/**
 * The virtual pad for the running test, or the reason there is none: the service isn't running
 * (a run without cargo, or a place run outside `bun run test`), Studio can't reach it, ViGEmBus
 * isn't installed, or what the test needs is off. Both are opt-in: plugging the pad in
 * (`VIRTUAL_PAD=1`, which starts the service with `--allow-plug`: every process on the machine sees
 * the pad, a Roblox Player's UI switches to gamepad mode) and pressing it (`VIRTUAL_PAD_INPUT=1`,
 * `--allow-input`, which implies plugging in: while Steam's Xbox controller support is on, Steam
 * turns the pad's buttons and sticks into keys and mouse input for whatever window is focused). A
 * test that only plugs the pad in passes `{ Input: false }`. A pad an earlier test left plugged in
 * is unplugged first.
 */
export function virtualPad(options?: { Input?: boolean }): VirtualPad | string {
	const reply = callVirtualPad("GET", "/health");
	if (!reply.Ok) return `the virtual-pad service can't be reached: ${reply.Error}`;
	const health = reply.Body as {
		bus?: string;
		connected?: boolean;
		plug?: boolean;
		input?: boolean;
	};
	if (health.bus !== "ok") return `the virtual-pad service has no ViGEmBus: ${health.bus}`;
	if (health.plug !== true) return PAD_OFF;
	if (options?.Input !== false && health.input !== true) return PAD_INPUT_OFF;
	if (health.connected === true) {
		const count = UserInputService.GetConnectedGamepads().size();
		callVirtualPad("POST", "/disconnect");
		waitUntil(() => UserInputService.GetConnectedGamepads().size() < count);
	}
	return new VirtualPad();
}
