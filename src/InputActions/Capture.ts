import { RunService, UserInputService } from "@rbxts/services";
import { ActionTypeName, IsKeyAllowed } from "./BindingRules";
import type { IRuntime } from "./Internal";
import { CapturableDevice, Device, GetKeyDevice } from "./KeyGroups";
import type { IChord } from "./Types";

// What `Capture` and `CaptureChord` hear, on a binding and on an action (design spec §6): keys that
// go down and come up, typing and game-processed input sorted out, keys already down at the start
// left alone, and, from 0.7.0, a gamepad's sticks and triggers as keys: a stick past halfway is its
// direction going down (`Thumbstick1Up`...).

const MOUSE_BUTTON_KEYS = new Map<Enum.UserInputType, Enum.KeyCode>([
	[Enum.UserInputType.MouseButton1, Enum.KeyCode.MouseLeftButton],
	[Enum.UserInputType.MouseButton2, Enum.KeyCode.MouseRightButton],
	[Enum.UserInputType.MouseButton3, Enum.KeyCode.MouseMiddleButton],
	[Enum.UserInputType.Touch, Enum.KeyCode.TouchPosition],
]);

/** The IAS key an InputBegan input stands for: its KeyCode, or the mouse button / touch key */
export function KeyFromInput(
	keyCode: Enum.KeyCode,
	inputType: Enum.UserInputType,
): Enum.KeyCode | undefined {
	if (keyCode !== Enum.KeyCode.None) return keyCode;
	return MOUSE_BUTTON_KEYS.get(inputType);
}

/**
 * IAS's default `PressedThreshold` and `ReleasedThreshold`: where a stick's direction or a trigger
 * goes down and up, on the value past the deadzone (`AnalogValues`)
 */
const PRESS_THRESHOLD = 0.5;
const RELEASE_THRESHOLD = 0.2;

/** A stick's four directions, and which way of its position each reads */
const STICK_DIRECTIONS = new Map<Enum.KeyCode, ReadonlyArray<[Enum.KeyCode, Vector2]>>([
	[
		Enum.KeyCode.Thumbstick1,
		[
			[Enum.KeyCode.Thumbstick1Up, new Vector2(0, 1)],
			[Enum.KeyCode.Thumbstick1Down, new Vector2(0, -1)],
			[Enum.KeyCode.Thumbstick1Left, new Vector2(-1, 0)],
			[Enum.KeyCode.Thumbstick1Right, new Vector2(1, 0)],
		],
	],
	[
		Enum.KeyCode.Thumbstick2,
		[
			[Enum.KeyCode.Thumbstick2Up, new Vector2(0, 1)],
			[Enum.KeyCode.Thumbstick2Down, new Vector2(0, -1)],
			[Enum.KeyCode.Thumbstick2Left, new Vector2(-1, 0)],
			[Enum.KeyCode.Thumbstick2Right, new Vector2(1, 0)],
		],
	],
]);
/** The stick each direction belongs to */
const STICK_OF = new Map<Enum.KeyCode, Enum.KeyCode>();
for (const [stick, directions] of STICK_DIRECTIONS) {
	for (const [direction] of directions) STICK_OF.set(direction, stick);
}
/** The triggers: analog, so they may arrive as InputChanged only (Position.Z) */
const TRIGGER_KEYS: readonly Enum.KeyCode[] = [Enum.KeyCode.ButtonL2, Enum.KeyCode.ButtonR2];

const GAMEPAD_INPUT_TYPES = new ReadonlySet<Enum.UserInputType>([
	Enum.UserInputType.Gamepad1,
	Enum.UserInputType.Gamepad2,
	Enum.UserInputType.Gamepad3,
	Enum.UserInputType.Gamepad4,
	Enum.UserInputType.Gamepad5,
	Enum.UserInputType.Gamepad6,
	Enum.UserInputType.Gamepad7,
	Enum.UserInputType.Gamepad8,
]);

/**
 * IAS's deadzone on a pad's sticks (radial: on the stick's distance from the centre) and triggers
 * (linear): a value under it reads 0, and the rest is rescaled to 0..1, before `PressedThreshold` and
 * `ReleasedThreshold` apply. Roblox's `InputObject.Position` is the raw value (measured with the
 * virtual pad, 2026-10-03: a Bool binding on `ButtonR2` pressed at raw 0.561 and released at 0.251;
 * stick directions pressed past raw 0.55 and released under 0.28)
 */
const PAD_DEADZONE = 0.1;

/** A raw stick distance or trigger pull as IAS reads it once past its deadzone */
function PastDeadzone(value: number): number {
	return math.max(0, (value - PAD_DEADZONE) / (1 - PAD_DEADZONE));
}

/**
 * How far an analog input (a stick's direction, a trigger) is pushed, as IAS reads it: past its
 * deadzone, rescaled, so the thresholds below count a key exactly where IAS presses a binding on it
 * (a raw push between 0.5 and 0.55 is no key: PAD-1)
 */
function AnalogValues(input: InputObject): Array<[Enum.KeyCode, number]> {
	const directions = STICK_DIRECTIONS.get(input.KeyCode);
	if (directions !== undefined) {
		const raw = new Vector2(input.Position.X, input.Position.Y);
		const distance = raw.Magnitude;
		const position = distance > 0 ? raw.mul(PastDeadzone(distance) / distance) : raw;
		return directions.map(([key, way]) => [key, position.Dot(way)]);
	}
	if (TRIGGER_KEYS.includes(input.KeyCode))
		return [[input.KeyCode, PastDeadzone(input.Position.Z)]];
	return [];
}

/**
 * The key a capture puts in `slot` for a key that went down, or undefined when the slot can't take
 * it: the key itself when allowed there (and `device`'s, given one); for a stick's direction that
 * isn't, its whole stick when allowed (a Direction2D `KeyCode` takes `Thumbstick1` from the first
 * stick pushed past halfway)
 */
export function CapturedKey(
	actionType: ActionTypeName,
	slot: string,
	key: Enum.KeyCode,
	device?: Device,
): Enum.KeyCode | undefined {
	if (IsKeyAllowed(actionType, slot, key, device)) return key;
	const stick = STICK_OF.get(key);
	if (stick !== undefined && IsKeyAllowed(actionType, slot, stick, device)) return stick;
	return undefined;
}

/**
 * How long after a TextBox loses focus input still counts as typing: what ends the typing (Return,
 * Escape, a click away) comes once the focus is gone (hunts HC2-3, HC3-1)
 */
const TYPING_GRACE = 0.1;
let focusWatch: RBXScriptConnection | undefined;
let focusReleasedAt = -math.huge;

/** Follows TextBox focus releases for `IsTyping`, from the first capture on */
function WatchTextBoxFocus() {
	focusWatch ??= UserInputService.TextBoxFocusReleased.Connect(() => {
		focusReleasedAt = os.clock();
	});
}

/** The keys of mouse buttons and touch: a click or tap */
const POINTER_BUTTON_KEYS = new ReadonlySet<Enum.KeyCode>([
	Enum.KeyCode.MouseLeftButton,
	Enum.KeyCode.MouseRightButton,
	Enum.KeyCode.MouseMiddleButton,
	Enum.KeyCode.TouchPosition,
]);

/**
 * Whether an input that began is typing, or what ends it: anything while a TextBox has focus; in the
 * moment after it lets go, what the game processed (Return, Escape) and a click or tap (a click
 * away). Other keys count again at once, so a key pressed right after a submit isn't lost
 */
function IsTyping(key: Enum.KeyCode, gameProcessed: boolean): boolean {
	if (UserInputService.GetFocusedTextBox() !== undefined) return true;
	if (os.clock() - focusReleasedAt >= TYPING_GRACE) return false;
	return gameProcessed || POINTER_BUTTON_KEYS.has(key);
}

/** What a capture makes of a key that began */
export const enum ECaptureInput {
	/** Typing in a TextBox, and what ends it: no part of the capture */
	Ignore,
	/** A Cancel key: ends the capture */
	Cancel,
	/**
	 * A key the game took (a GUI click, a key a ContextActionService binding sinks, such as an
	 * InputCatcher's): a CAS sink blocks IAS for it, so a binding couldn't use it, nor a chord with it
	 */
	Taken,
	/** A key the capture counts */
	Count,
}

/**
 * What a capture makes of a key that began: typing, and the key or click that ends it (which the
 * game may not have processed: a click away from the TextBox), is no part of it; a Cancel key ends
 * it, from any device, also when the game took it (an InputCatcher, any CAS sink), so the player
 * can always back out; any other key the game took is the game's
 */
export function ClassifyCaptureInput(
	key: Enum.KeyCode,
	gameProcessed: boolean,
	cancelKeys: readonly Enum.KeyCode[],
): ECaptureInput {
	if (IsTyping(key, gameProcessed)) return ECaptureInput.Ignore;
	if (cancelKeys.includes(key)) return ECaptureInput.Cancel;
	return gameProcessed ? ECaptureInput.Taken : ECaptureInput.Count;
}

/**
 * The keys down as a capture starts: keyboard keys (VirtualInput's gamepad KeyCodes among them),
 * mouse buttons, gamepad buttons, and the directions of sticks and the triggers pushed past halfway.
 * Their InputBegan may still be on its way (a ContextActionService action that starts a capture
 * runs before InputBegan fires; deferred signals), and must not count: the press that started a
 * capture is no part of it (hunt HC2-2). A finger down reads as mouse button 1 and arrives as
 * `TouchPosition`, so mouse button 1 stands for both (hunt HC3-2)
 */
function KeysDownNow(): Set<Enum.KeyCode> {
	const keys = new Set<Enum.KeyCode>();
	for (const input of UserInputService.GetKeysPressed()) keys.add(input.KeyCode);
	for (const [inputType, key] of MOUSE_BUTTON_KEYS) {
		if (inputType !== Enum.UserInputType.Touch && UserInputService.IsMouseButtonPressed(inputType))
			keys.add(key);
	}
	if (keys.has(Enum.KeyCode.MouseLeftButton)) keys.add(Enum.KeyCode.TouchPosition);
	for (const gamepad of UserInputService.GetConnectedGamepads()) {
		for (const input of UserInputService.GetGamepadState(gamepad)) {
			// A trigger is down past halfway only, as a capture hears it (below)
			if (
				input.UserInputState === Enum.UserInputState.Begin &&
				!TRIGGER_KEYS.includes(input.KeyCode)
			)
				keys.add(input.KeyCode);
			for (const [key, value] of AnalogValues(input)) {
				if (value > PRESS_THRESHOLD) keys.add(key);
			}
		}
	}
	return keys;
}

/** The two keys one pointer stands for: a mouse's button 1, or a finger, which reads as it */
const POINTER_KEYS: readonly Enum.KeyCode[] = [
	Enum.KeyCode.MouseLeftButton,
	Enum.KeyCode.TouchPosition,
];

/**
 * Forgets a key among those down when a capture started, once it has come up (a pointer's two keys
 * together). True when it was one of them: its release is no part of the capture either
 */
function ReleaseDownAtStart(down: Set<Enum.KeyCode>, key: Enum.KeyCode): boolean {
	if (!POINTER_KEYS.includes(key)) return down.delete(key);
	let was = false;
	for (const pointer of POINTER_KEYS) if (down.delete(pointer)) was = true;
	return was;
}

/**
 * The keys down as a capture starts, which it leaves alone until they come up. A pointer key among
 * them stands only for a press whose InputBegan arrives before the next Heartbeat (the press that
 * started the capture, still on its way): mouse button 1, which also stands for a finger, still
 * reads pressed a frame after a finger lifts (measured on the simulated phone, 2026-10-02), so a
 * pointer press after that is a new click or tap
 */
class DownAtStart {
	readonly Keys = KeysDownNow();
	private _startFrame = true;

	constructor() {
		RunService.Heartbeat.Once(() => (this._startFrame = false));
	}

	/** Whether an InputBegan of `key` is a press that was down already when the capture started */
	Began(key: Enum.KeyCode): boolean {
		if (!this.Keys.has(key)) return false;
		if (this._startFrame || !POINTER_KEYS.includes(key)) return true;
		ReleaseDownAtStart(this.Keys, key);
		return false;
	}

	/** Forgets `key` once it is up; true when it was down already when the capture started */
	Ended(key: Enum.KeyCode): boolean {
		return ReleaseDownAtStart(this.Keys, key);
	}
}

/**
 * The keys a capture hears, in the order they go down and come up. A stick is heard through
 * `InputChanged` only (Roblox sends nothing else for one: measured): each direction goes down past
 * halfway (0.5, IAS's default `PressedThreshold`) and comes up back under 0.2, as IAS reads it past
 * its deadzone (`AnalogValues`). A pad's trigger goes down past halfway too, at its `InputBegan` or
 * an `InputChanged`, whichever shows it there first (an `InputBegan` below halfway waits for one:
 * hunt HD-4), and comes up under 0.2 or at its `InputEnded`, whichever comes first. Measured with
 * the virtual pad: an `InputChanged` at every change, `InputBegan` only all the way down, and
 * `InputEnded` only back at rest, so the `InputChanged` decides. A trigger's KeyCode sent as
 * keyboard input (VirtualInput) has no position, and goes down and up with its
 * `InputBegan`/`InputEnded`. Mouse movement, the wheel and touch drags change only, and are never
 * heard. Keys down when it starts are heard only once they have come up and gone down again.
 */
class CaptureInput {
	private readonly _connections = new Array<RBXScriptConnection>();
	private readonly _downAtStart = new DownAtStart();
	/** The analog keys down now: a stick's directions, the triggers */
	private readonly _analogDown = new Set<Enum.KeyCode>();
	private _live = true;

	constructor(
		private readonly _runtime: IRuntime,
		onDown: (key: Enum.KeyCode, gameProcessed: boolean) => void,
		onUp: (key: Enum.KeyCode) => void,
	) {
		WatchTextBoxFocus();
		for (const key of this._downAtStart.Keys) {
			if (STICK_OF.has(key) || TRIGGER_KEYS.includes(key)) this._analogDown.add(key);
		}
		const down = (key: Enum.KeyCode, gameProcessed: boolean) => {
			if (this._live && !this._downAtStart.Began(key)) onDown(key, gameProcessed);
		};
		const up = (key: Enum.KeyCode) => {
			if (this._live && !this._downAtStart.Ended(key)) onUp(key);
		};
		this._connections.push(
			UserInputService.InputBegan.Connect((input, gameProcessed) => {
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined || STICK_DIRECTIONS.has(key)) return;
				if (TRIGGER_KEYS.includes(key)) {
					if (this._analogDown.has(key)) return;
					const pad = GAMEPAD_INPUT_TYPES.has(input.UserInputType);
					if (pad && AnalogValues(input)[0][1] <= PRESS_THRESHOLD) return;
					this._analogDown.add(key);
				}
				down(key, gameProcessed);
			}),
			UserInputService.InputEnded.Connect((input) => {
				const key = KeyFromInput(input.KeyCode, input.UserInputType);
				if (key === undefined || STICK_DIRECTIONS.has(key)) return;
				if (TRIGGER_KEYS.includes(key) && !this._analogDown.delete(key)) return;
				up(key);
			}),
			UserInputService.InputChanged.Connect((input, gameProcessed) => {
				if (!GAMEPAD_INPUT_TYPES.has(input.UserInputType)) return;
				for (const [key, value] of AnalogValues(input)) {
					if (!this._analogDown.has(key) && value > PRESS_THRESHOLD) {
						this._analogDown.add(key);
						down(key, gameProcessed);
					} else if (this._analogDown.has(key) && value < RELEASE_THRESHOLD) {
						this._analogDown.delete(key);
						up(key);
					}
				}
			}),
		);
		for (const connection of this._connections) _runtime.TrackConnection(connection);
	}

	Stop() {
		if (!this._live) return;
		this._live = false;
		for (const connection of this._connections) {
			connection.Disconnect();
			this._runtime.UntrackConnection(connection);
		}
	}
}

/** Where a captured key goes: the binding, and the slot and key it takes */
export interface ICaptureTarget<T> {
	Binding: T;
	Slot: string;
	Key: Enum.KeyCode;
}

/**
 * Waits for the next key that `pick` gives a place to (`Capture`, on a binding or an action), then
 * stops and calls `onCaptured` with it. A `Cancel` key, from any device, stops it with nothing
 * applied and calls `onCancelled`. Typing and keys the game took are no part of it. Returns the
 * function that stops it, which calls neither.
 */
export function CaptureKey<T>(
	runtime: IRuntime,
	pick: (key: Enum.KeyCode) => ICaptureTarget<T> | undefined,
	onCaptured: (target: ICaptureTarget<T>, key: Enum.KeyCode) => void,
	onCancelled: () => void,
	cancelKeys: readonly Enum.KeyCode[],
): () => void {
	let input: CaptureInput | undefined = undefined;
	const stop = () => input?.Stop();
	input = new CaptureInput(
		runtime,
		(key, gameProcessed) => {
			const kind = ClassifyCaptureInput(key, gameProcessed, cancelKeys);
			if (kind === ECaptureInput.Cancel) {
				stop();
				if (!runtime.IsDestroyed()) onCancelled();
				return;
			}
			if (kind !== ECaptureInput.Count) return;
			const target = pick(key);
			if (target === undefined) return;
			stop();
			onCaptured(target, key);
		},
		() => {},
	);
	return stop;
}

/** The action types `CaptureChord` works on: their `KeyCode` takes keys that can be pressed */
export const CHORD_TYPES = new ReadonlySet<ActionTypeName>(["Bool", "Direction1D"]);

/**
 * The chord keys held together make, in the order they went down: the last is the `KeyCode`, the
 * ones before it the modifiers. Undefined when a binding of this action type (and of `device`,
 * given one) can't hold it: more than three keys, a `KeyCode` the type can't use, or a modifier that
 * isn't a Button key
 */
export function ChordFromKeys(
	actionType: ActionTypeName,
	keys: readonly Enum.KeyCode[],
	device?: Device,
): IChord | undefined {
	const count = keys.size();
	if (count === 0 || count > 3) return undefined;
	const key = keys[count - 1];
	if (!IsKeyAllowed(actionType, "KeyCode", key, device)) return undefined;
	const primary = count >= 2 ? keys[0] : undefined;
	const secondary = count === 3 ? keys[1] : undefined;
	if (primary !== undefined && !IsKeyAllowed(actionType, "PrimaryModifier", primary, device))
		return undefined;
	if (secondary !== undefined && !IsKeyAllowed(actionType, "SecondaryModifier", secondary, device))
		return undefined;
	return { KeyCode: key, PrimaryModifier: primary, SecondaryModifier: secondary };
}

/** Whether a `CaptureChord` Timeout is valid: a positive, finite number of seconds */
export function IsValidTimeout(timeout: unknown): boolean {
	return typeIs(timeout, "number") && timeout > 0 && timeout < math.huge;
}

/**
 * Waits for a chord (see `IChordBindingHandle.CaptureChord`) of one of `devices`. It follows the keys
 * that go down while it waits, in order; a key already down when it started is not among them, and
 * its release settles nothing. The first key that goes down picks the device, and the others' keys
 * are ignored until every key of the chord is up. The first of them to come up settles the chord:
 * applied when the binding can hold it, else ignored, and then the next chord counts once every key
 * of this one is up (so the release of the last leftover key of a refused chord can't settle a chord
 * of its own). With a `Timeout`, the keys held when it runs out settle the chord the same way; when
 * they make none the binding can hold, or none are held, the capture ends with nothing.
 * @param onSettled called once, unless the returned function stops it first: with the chord and its
 * device, or with nothing
 */
export function CaptureChord(
	runtime: IRuntime,
	actionType: ActionTypeName,
	devices: readonly CapturableDevice[],
	onSettled: (chord: IChord | undefined, device: CapturableDevice | undefined) => void,
	cancelKeys: readonly Enum.KeyCode[],
	timeout?: number,
): () => void {
	const held = new Array<Enum.KeyCode>();
	// the keys among `held` the game took: a chord with one can't be bound as pressed (hunt HC2-1)
	const taken = new Set<Enum.KeyCode>();
	// the device of the keys held: the first that went down picks it
	let device: CapturableDevice | undefined;
	const heldChord = () => (taken.isEmpty() ? ChordFromKeys(actionType, held, device) : undefined);
	// false after a refused chord, until every key of it is up
	let armed = true;
	let live = true;
	let input: CaptureInput | undefined;
	let timer: thread | undefined;
	const stop = () => {
		if (!live) return;
		live = false;
		input?.Stop();
		if (timer !== undefined && timer !== coroutine.running()) task.cancel(timer);
	};
	// Ends the capture, telling the callback what the held keys make (when that may be applied)
	const settle = (chord: IChord | undefined) => {
		stop();
		if (runtime.IsDestroyed()) return;
		onSettled(chord, chord !== undefined ? device : undefined);
	};
	input = new CaptureInput(
		runtime,
		(key, gameProcessed) => {
			const kind = ClassifyCaptureInput(key, gameProcessed, cancelKeys);
			if (kind === ECaptureInput.Ignore) return;
			if (kind === ECaptureInput.Cancel) return settle(undefined);
			const keyDevice = GetKeyDevice(key);
			if (!(devices as readonly Device[]).includes(keyDevice)) return;
			if (device !== undefined && keyDevice !== device) return;
			device = keyDevice as CapturableDevice;
			if (kind === ECaptureInput.Taken) taken.add(key);
			if (!held.includes(key)) held.push(key);
		},
		(key) => {
			const index = held.indexOf(key);
			if (index === -1) return;
			if (armed) {
				const chord = heldChord();
				if (chord !== undefined) return settle(chord);
				armed = false;
			}
			held.remove(index);
			taken.delete(key);
			if (held.size() === 0) {
				armed = true;
				device = undefined;
			}
		},
	);
	if (timeout !== undefined) {
		timer = task.delay(timeout, () => {
			if (!live) return;
			settle(armed ? heldChord() : undefined);
		});
	}
	return stop;
}
