import { EveryFrame } from "../Internal/EveryFrame";
import { IsLive, ResetSince } from "./Internal";
import type { IDoubleTapOptions, IHoldOptions, ILongPressOptions, ITapOptions } from "./Types";

// Gestures on Bool actions (design spec §6, F4): tap, double tap, hold, long press. Built on the
// handle's own `Pressed` and `Released`, which always alternate, timed with `os.clock` from when
// each arrives. No per-frame work but a Hold's `Progress` while held.

/** Seconds a press may last and still be a tap */
export const DEFAULT_TAP_DURATION = 0.25;
/** Seconds from a tap's release within which a second press makes a double tap */
export const DEFAULT_DOUBLE_TAP_WINDOW = 0.3;

/** What a gesture listens to: an action handle */
export interface IGestureSource {
	readonly Name: string;
	/** The action the handle wraps now */
	readonly Instance: InputAction;
	readonly Pressed: RBXScriptSignal<() => void>;
	readonly Released: RBXScriptSignal<() => void>;
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
	 * held, the Server Authority swap), which ends the gesture without completing it
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
	const connections = [
		source.Pressed.Connect(() => {
			if (!live || source.IsDestroyed()) return;
			start = os.clock();
			edges.Pressed(start);
		}),
		source.Released.Connect(() => {
			const began = start;
			start = undefined;
			if (!live || source.IsDestroyed() || began === undefined) return;
			const action = source.Instance;
			edges.Released(os.clock(), began, !IsLive(action) || ResetSince(action, began));
		}),
	];
	const stop = () => {
		if (!live) return;
		live = false;
		for (const connection of connections) connection.Disconnect();
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
	/** The press in progress came within the window after a tap: a double tap's second, no tap */
	let second = false;
	return Listen(source, {
		Pressed() {
			second = pending !== undefined;
			CancelTimer(pending);
			pending = undefined;
		},
		Released(now, start, reset) {
			if (reset || now - start > maxDuration) return;
			if (!waitForDoubleTap) return callback();
			if (second) return;
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
	const finish = () => {
		holding = undefined;
		CancelTimer(timer);
		timer = undefined;
		stopFrames?.();
		stopFrames = undefined;
	};
	const complete = () => {
		if (holding === undefined || source.IsDestroyed()) return;
		finish();
		progress?.(1);
		callback();
	};
	return Listen(source, {
		Pressed(now) {
			finish();
			holding = now;
			timer = task.delay(duration, complete);
			if (progress === undefined) return;
			progress(0);
			// Per-frame work while the hold is in progress only
			stopFrames = EveryFrame(() => {
				if (holding === undefined) return;
				const fraction = (os.clock() - holding) / duration;
				if (fraction >= 1) complete();
				else progress(fraction);
			});
		},
		Released() {
			if (holding === undefined) return;
			finish();
			progress?.(0);
			cancelled?.();
		},
		Stop() {
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
