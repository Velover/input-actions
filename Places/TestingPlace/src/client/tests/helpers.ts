import { defer, scratch } from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { LogService, RunService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

/**
 * Waits for the next frame: the next Heartbeat after a render step or a PreAnimation, the ticks in
 * which the package's per-frame work runs (`EveryFrame`). A Studio window that renders nothing also
 * has Heartbeat ticks without PreAnimation or simulation (probed: 9 to 87 of 600 ticks, even with
 * nothing else running). The package's per-frame work skips those ticks, so they are not frames
 * here either: a TrackPrevious flag would otherwise show on two readings. A window that renders may
 * render in such a tick, and then the work runs there: that tick is a frame.
 */
export function frame() {
	let ran = false;
	const Mark = () => {
		ran = true;
	};
	const animation = RunService.PreAnimation.Connect(Mark);
	const render = RunService.RenderStepped.Connect(Mark);
	while (!ran) RunService.Heartbeat.Wait();
	animation.Disconnect();
	render.Disconnect();
}

/** Waits `count` frames */
export function frames(count: number) {
	for (let index = 0; index < count; index++) frame();
}

/** A fresh folder for a test's contexts, destroyed after the test */
export function newFolder(name = "Inputs") {
	const folder = new Instance("Folder");
	folder.Name = name;
	folder.Parent = scratch();
	return folder;
}

/** `TEST_SCHEMA` created in a fresh folder; destroyed after the test */
export function createTestInput(
	folder: Instance = newFolder(),
	options?: InputActions.CreateOptions,
) {
	const input = InputActions.Create(TEST_SCHEMA, { ...options, Folder: folder });
	defer(() => input.Destroy());
	return input;
}

/** Counts the calls of a signal until the test ends */
export function countSignal(signal: RBXScriptSignal): { count: number } {
	const counter = { count: 0 };
	const connection = signal.Connect(() => counter.count++);
	defer(() => connection.Disconnect());
	return counter;
}

/** Records every value a signal passes until the test ends */
export function recordSignal<T extends defined>(signal: RBXScriptSignal<(value: T) => void>): T[] {
	const values = new Array<T>();
	const connection = signal.Connect((value) => {
		values.push(value);
	});
	defer(() => connection.Disconnect());
	return values;
}

export function nearlyEqual(a: number, b: number, epsilon = 1e-4) {
	return math.abs(a - b) <= epsilon;
}

/** Records warnings until the test ends */
export function recordWarnings() {
	const messages = new Array<string>();
	const connection = LogService.MessageOut.Connect((message, messageType) => {
		if (messageType === Enum.MessageType.MessageWarning) messages.push(message);
	});
	defer(() => connection.Disconnect());
	return messages;
}
