import { EveryFrame } from "../Internal/EveryFrame";
import { IsLive } from "./Internal";
import type { IDoubleTapOptions, IHoldOptions, ILongPressOptions, ITapOptions } from "./Types";

// Gestures on Bool actions (design spec §6, F4): tap, double tap, hold, long press. Built on the
// handle's presses and releases as its listeners hear them (`Pressed` and `Released`, which always
// alternate), timed with `os.clock` from when each arrives at the handle. No per-frame work but a
// Hold's `Progress` while held.

/** Seconds a press may last and still be a tap */
export const DEFAULT_TAP_DURATION = 0.25;
/** Seconds from a tap's release within which a second press makes a double tap */
export const DEFAULT_DOUBLE_TAP_WINDOW = 0.3;

/**
 * One press or release the handle passed on: its number (counted from the handle's first), whether
 * it is a press, when it arrived (`os.clock`), and for a release whether it is a reset's
 */
export type GestureEdge = (edge: number, pressed: boolean, at: number, reset: boolean) => void;

/** What a gesture listens to: an action handle */
export interface IGestureSource {
	readonly Name: string;
	/** The action the handle wraps now */
	readonly Instance: InputAction;
	/**
	 * The handle's presses and releases as its listeners hear them (`Pressed` and `Released`
	 * always alternate), each with when it arrived, and for a release whether it is a reset's,
	 * worked out once as it arrived: every gesture gets the same answer (hunt HF-7)
	 */
	GestureEdges(): RBXScriptSignal<GestureEdge>;
	/** How many edges the handle has passed on: a gesture made now starts after them */
	EdgeCount(): number;
	IsDestroyed(): boolean;
	/** Keeps a running gesture's stop function, for `Destroy` */
	AddGesture(stop: () => void): void;
	RemoveGesture(stop: () => void): void;
}

/** A gesture's answers to the handle's edges */
interface IGestureEdges {
	/** A press began, at `now` */
	Pressed(now: number): void;
	/**
	 * The press that began at `start` ended at `now`. `reset`: no player's release, but a reset's
	 * (the context or the action disabled, the focus-loss reset, a key change or a binding added while
	 * held, another root handle's `Destroy`, the Server Authority swap), which ends the gesture
	 * without completing it
	 */
	Released(now: number, start: number, reset: boolean): void;
	/** The gesture is stopped (its function, `Destroy`): it calls nothing more */
	Stop?(): void;
}

/** Whether a duration option is valid: a positive, finite number of seconds */
function IsSeconds(value: unknown): value is number {
	return typeIs(value, "number") && value > 0 && value < math.huge;
}

/** An option in seconds: its default when left out; throws when it isn't a positive finite number */
function Seconds(
	source: IGestureSource,
	method: string,
	name: string,
	value: unknown,
	fallback?: number,
) {
	if (value === undefined && fallback !== undefined) return fallback;
	if (!IsSeconds(value))
		error(
			`InputActions: ${source.Name}: ${method}'s ${name} must be a positive number of seconds`,
			4,
		);
	return value;
}

/** Throws unless `value` is a function (or, `optional`, left out) */
function CheckFunction(
	source: IGestureSource,
	method: string,
	name: string,
	value: unknown,
	optional = false,
) {
	if (optional && value === undefined) return;
	if (!typeIs(value, "function"))
		error(`InputActions: ${source.Name}: ${method}'s ${name} must be a function`, 4);
}

/**
 * Runs a gesture on the handle's edges until the returned function or `Destroy` stops it. A press
 * already in progress when it starts is no part of it: its release is ignored. Nothing runs once
 * the root handle is destroyed, also a delivery already on its way then (Deferred signals)
 */
function Listen(source: IGestureSource, edges: IGestureEdges): () => void {
	// After Destroy the handles change nothing
	if (source.IsDestroyed()) return () => {};
	let start: number | undefined;
	let live = true;
	// An edge passed on before the gesture was made is no part of it, also one still on its way
	const since = source.EdgeCount();
	const connection = source.GestureEdges().Connect((edge, pressed, at, reset) => {
		if (edge <= since) return;
		if (pressed) {
			if (!live || source.IsDestroyed()) return;
			start = at;
			edges.Pressed(at);
			return;
		}
		const began = start;
		start = undefined;
		if (!live || source.IsDestroyed() || began === undefined) return;
		edges.Released(at, began, reset);
	});
	const stop = () => {
		if (!live) return;
		live = false;
		connection.Disconnect();
		source.RemoveGesture(stop);
		edges.Stop?.();
	};
	source.AddGesture(stop);
	return stop;
}

/** Cancels a thread made by `task.delay`, unless it is the one running (it ends by itself then) */
function CancelTimer(timer: thread | undefined) {
	if (timer !== undefined && timer !== coroutine.running()) task.cancel(timer);
}

/** See `IBoolActionHandle.OnTap` */
export function OnTap(
	source: IGestureSource,
	callback: () => void,
	options?: ITapOptions,
): () => void {
	CheckFunction(source, "OnTap", "callback", callback);
	const maxDuration = Seconds(
		source,
		"OnTap",
		"MaxDuration",
		options?.MaxDuration,
		DEFAULT_TAP_DURATION,
	);
	const window = Seconds(source, "OnTap", "Window", options?.Window, DEFAULT_DOUBLE_TAP_WINDOW);
	const waitForDoubleTap = options?.WaitForDoubleTap === true;
	/** A tap waiting for the double-tap window to pass without a second press */
	let pending: thread | undefined;
	/** When the waiting tap's release arrived */
	let pendingSince = 0;
	/** The press in progress came within the window after a tap: a double tap's second, no tap */
	let second = false;
	return Listen(source, {
		Pressed(now) {
			const waiting = pending !== undefined;
			CancelTimer(pending);
			pending = undefined;
			// Within the window, as `OnDoubleTap` counts it, by the time the press arrived: a press
			// after it, in a frame that ran long before the window's timer could (a hitch), comes
			// after a tap that the window let through (hunt HF-3)
			second = waiting && now - pendingSince <= window;
			if (waiting && !second && !source.IsDestroyed() && IsLive(source.Instance)) callback();
		},
		Released(now, start, reset) {
			if (reset || now - start > maxDuration) return;
			if (!waitForDoubleTap) return callback();
			if (second) return;
			pendingSince = now;
			pending = task.delay(window, () => {
				pending = undefined;
				// The action disabled meanwhile (a menu opened): the tap is dropped
				if (source.IsDestroyed() || !IsLive(source.Instance)) return;
				callback();
			});
		},
		Stop() {
			CancelTimer(pending);
			pending = undefined;
		},
	});
}

/** See `IBoolActionHandle.OnDoubleTap` */
export function OnDoubleTap(
	source: IGestureSource,
	callback: () => void,
	options?: IDoubleTapOptions,
): () => void {
	CheckFunction(source, "OnDoubleTap", "callback", callback);
	const window = Seconds(
		source,
		"OnDoubleTap",
		"Window",
		options?.Window,
		DEFAULT_DOUBLE_TAP_WINDOW,
	);
	const maxDuration = Seconds(
		source,
		"OnDoubleTap",
		"MaxDuration",
		options?.MaxDuration,
		DEFAULT_TAP_DURATION,
	);
	/** When the last tap that may be a double tap's first ended */
	let firstTapEnd: number | undefined;
	/** The press in progress is a double tap's second: its release starts no new one */
	let second = false;
	return Listen(source, {
		Pressed(now) {
			second = firstTapEnd !== undefined && now - firstTapEnd <= window;
			firstTapEnd = undefined;
			if (second) callback();
		},
		Released(now, start, reset) {
			if (second) {
				second = false;
				return;
			}
			if (!reset && now - start <= maxDuration) firstTapEnd = now;
		},
	});
}

/** See `IBoolActionHandle.OnHold` */
export function OnHold(
	source: IGestureSource,
	callback: () => void,
	options: IHoldOptions,
): () => void {
	CheckFunction(source, "OnHold", "callback", callback);
	if (!typeIs(options, "table"))
		error(`InputActions: ${source.Name}: OnHold needs its options, { Duration }`, 3);
	const duration = Seconds(source, "OnHold", "Duration", options.Duration);
	const progress = options.Progress;
	const cancelled = options.Cancelled;
	CheckFunction(source, "OnHold", "Progress", progress, true);
	CheckFunction(source, "OnHold", "Cancelled", cancelled, true);
	/** The hold in progress: when its press began */
	let holding: number | undefined;
	let timer: thread | undefined;
	let stopFrames: (() => void) | undefined;
	/** Stopped (its function, `Destroy`): calls nothing more, also from inside its own `Progress` */
	let stopped = false;
	/** Whether the gesture may still call anything: `Progress` may stop it, or destroy the root handle */
	const running = () => !stopped && !source.IsDestroyed();
	const finish = () => {
		holding = undefined;
		CancelTimer(timer);
		timer = undefined;
		stopFrames?.();
		stopFrames = undefined;
	};
	const complete = () => {
		if (holding === undefined || !running()) return;
		finish();
		progress?.(1);
		// Stopped from `Progress(1)`: nothing more (hunt HF-5)
		if (running()) callback();
	};
	return Listen(source, {
		Pressed(now) {
			finish();
			holding = now;
			timer = task.delay(duration, complete);
			if (progress === undefined) return;
			progress(0);
			// Stopped from `Progress(0)`: no per-frame work left behind
			if (holding === undefined || !running()) return;
			// Per-frame work while the hold is in progress only
			stopFrames = EveryFrame(() => {
				if (holding === undefined) return;
				const fraction = (os.clock() - holding) / duration;
				if (fraction >= 1) complete();
				else progress(fraction);
			});
		},
		Released(now, _start, reset) {
			if (holding === undefined) return;
			// A press that lasted `Duration`, released before the hold's timer or a frame could run
			// (a frame that ran long): it held long enough, and completes, as the long press it also
			// is (hunt HF-4). A reset's release ends it without completing it
			if (!reset && now - holding >= duration) return complete();
			finish();
			progress?.(0);
			// Stopped from `Progress(0)`: nothing more (hunt HF-5)
			if (running()) cancelled?.();
		},
		Stop() {
			stopped = true;
			finish();
		},
	});
}

/** See `IBoolActionHandle.OnLongPress` */
export function OnLongPress(
	source: IGestureSource,
	callback: (heldFor: number) => void,
	options: ILongPressOptions,
): () => void {
	CheckFunction(source, "OnLongPress", "callback", callback);
	if (!typeIs(options, "table"))
		error(`InputActions: ${source.Name}: OnLongPress needs its options, { Duration }`, 3);
	const duration = Seconds(source, "OnLongPress", "Duration", options.Duration);
	return Listen(source, {
		Pressed() {},
		Released(now, start, reset) {
			const heldFor = now - start;
			if (!reset && heldFor >= duration) callback(heldFor);
		},
	});
}
