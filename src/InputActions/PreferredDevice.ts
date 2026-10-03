import { RunService, UserInputService } from "@rbxts/services";
import type { Device } from "./KeyGroups";

// The device the player uses (design spec §6): `UserInputService.PreferredInput` as the binding name
// that holds its keys, and the signal that tells when it changes.

/**
 * The device the player uses, as the binding name that holds its keys: `PreferredInput`, with the
 * TV remote (`MicroGamepad`) as `"Gamepad"`
 */
export function PreferredDevice(): Device {
	const preferred = UserInputService.PreferredInput;
	if (preferred === Enum.PreferredInput.Touch) return "Touch";
	if (preferred === Enum.PreferredInput.Gamepad || preferred === Enum.PreferredInput.MicroGamepad)
		return "Gamepad";
	return "KeyboardAndMouse";
}

/** The event behind the signal, kept for the session */
let changedEvent: BindableEvent | undefined;
/** The signal, the same object each read */
let changed: RBXScriptSignal<(device: Device) => void> | undefined;

/**
 * `InputActions.PreferredDeviceChanged`, made the first time it is read: an event fired with the
 * device each time `PreferredDevice()` changes. It follows `PreferredInput`'s property signal,
 * connected once for the module, on the client only: on the server it never fires. `MicroGamepad`
 * and `Gamepad` read alike, so a switch between them fires nothing, and it never fires the same
 * device twice in a row (it fires the device it reads, compared with the one it fired last, or the
 * one it read when it was made).
 */
export function PreferredDeviceChanged(): RBXScriptSignal<(device: Device) => void> {
	if (changed === undefined) {
		const event = new Instance("BindableEvent");
		changedEvent = event;
		changed = event.Event as RBXScriptSignal<(device: Device) => void>;
		if (RunService.IsClient()) {
			let last = PreferredDevice();
			UserInputService.GetPropertyChangedSignal("PreferredInput").Connect(() => {
				const device = PreferredDevice();
				if (device === last) return;
				last = device;
				event.Fire(device);
			});
		}
	}
	return changed;
}
