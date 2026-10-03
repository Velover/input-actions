// A settings screen: a column per device with the current keys as text (Describe), a Primary and an
// Alternate key per device (an `Alt` extra the schema declares), a one-field rebind per action,
// capturing a key or a chord into one device's binding, the keys it then shares with other actions
// (FindConflicts), and saving and loading the rebinds.
import { InputActions } from "@rbxts/input-actions";

const InputSchema = InputActions.Schema({
	Gameplay: {
		Actions: {
			// each device's main binding, and an Alternate one the player fills ({}: no keys yet)
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: Enum.KeyCode.Space, Alt: {} },
				Gamepad: { Main: Enum.KeyCode.ButtonA, Alt: {} },
			}),
			// a chord: Ctrl+S, and F5 as its Alternate; no gamepad key in the schema, but a player can
			// give it one
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: {
					Main: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
					Alt: Enum.KeyCode.F5,
				},
			}),
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S },
				Gamepad: Enum.KeyCode.ButtonR2,
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Gamepad: Enum.KeyCode.Thumbstick1,
			}),
		},
	},
});

const Input = InputActions.Create(InputSchema);
const { Jump, QuickSave, Throttle, Move } = Input.Gameplay.Actions;

/** The menu's columns: the devices with keys to press (touch has none) */
const COLUMNS = ["KeyboardAndMouse", "Gamepad"] as const;

/** Each device's two keys: its main binding, and the `Alt` extra where the schema declares one */
type Slot = "Primary" | "Alternate";

/**
 * The binding of a cell: the device's main binding, or its `Alt` extra, by name at runtime, so one
 * function serves every row (Throttle declares none: its Alternate cells are empty)
 */
function CellBinding(
	action: InputActions.CaptureAction,
	device: InputActions.CapturableDevice,
	slot: Slot,
) {
	const binding = action.Bindings[device];
	return slot === "Primary" ? binding : binding.Extras().Alt;
}

/** Keys that close a capture without a change, from either device */
const CANCEL = [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB];

/**
 * A cell's text: "Ctrl + S", "W / S", "LT" (Describe reads the binding as it is now, in the player's
 * keyboard layout); "(unbound)" for a binding without keys. For the gamepad's icons, pass the keys of
 * `binding.Get()` to `UserInputService.GetImageForKeyCode`
 */
function CellText(binding: InputActions.BindingHandle<Enum.InputActionType, InputActions.Device> | undefined) {
	if (binding === undefined) return "-";
	const text = binding.Describe();
	return text === "" ? "(unbound)" : text;
}

/** The rows: one per action with a one-field capture (Bool and Direction1D actions) */
const ROWS: Array<[string, InputActions.CaptureAction]> = [
	["Jump", Jump],
	["Quick save", QuickSave],
	["Throttle", Throttle],
];

// Text labels refresh whenever a binding changes, whatever changed it, an Alternate key included,
// and when the player switches device. Each row shows its keys on both devices, Primary /
// Alternate; the column of the device the player uses is marked, and every key another action
// also uses is flagged
function RefreshLabels() {
	const preferred = InputActions.PreferredDevice();
	const shared = new Set<string>();
	for (const pair of Input.Gameplay.FindConflicts()) {
		shared.add(pair.Paths[0]);
		shared.add(pair.Paths[1]);
	}
	for (const [name, action] of ROWS) {
		const cells = COLUMNS.map((device) => {
			const primary = action.Bindings[device];
			const alternate = CellBinding(action, device, "Alternate");
			const keys = `${CellText(primary)} / ${CellText(alternate)}`;
			return device === preferred ? `[${keys}]` : keys;
		});
		print(`${name}: ${cells.join(" | ")}`);
	}
	print(`Move: ${Move.Describe("KeyboardAndMouse")} | ${Move.Describe("Gamepad")}`);
	if (shared.size() > 0) print(`keys used twice: ${[...shared].join(", ")}`);
}
Input.BindingsChanged.Connect(RefreshLabels);
InputActions.PreferredDeviceChanged.Connect(RefreshLabels);
RefreshLabels();

/** Whether the menu offers rebinding at all: on a phone there are no keys to capture */
export function CanRebind() {
	return InputActions.PreferredDevice() !== "Touch";
}

// One field per action: "Press a key or a button for Jump". The first key pressed picks the
// device, and that device's binding becomes the key alone (Quick save's Ctrl+S captured with F is
// F); the other device's binding is left alone. On a gamepad, unselect the menu's button while the
// capture runs (GuiService.SelectedObject = undefined): Roblox's UI navigation takes ButtonA
// meanwhile. Then the menu looks for the other bindings that now share the key, and takes it from
// them: `Clear(conflict.Slot)` clears the one slot that holds it, so S captured for Jump leaves
// Move's W, A and D (`Clear()` would unbind Move; or swap: set that slot to the key this binding
// had). `Identical` is false when they only overlap: a chord and its plain key, which IAS both
// presses (a chord doesn't block its plain key). A Cancel key calls back with undefined
export function RebindAction(action: InputActions.CaptureAction): () => void {
	return action.Capture(
		(key, device) => {
			if (key === undefined || device === undefined) return print(`${action.Name} unchanged`);
			print(`${action.Name} is now ${key.Name} on ${device}`);
			for (const conflict of Input.FindConflicts(action.Bindings[device])) {
				const how = conflict.Identical ? "the same keys" : "overlapping keys";
				warn(`${conflict.Key.Name} was also ${conflict.Path} (${how}): cleared there`);
				conflict.Binding.Clear(conflict.Slot);
			}
		},
		{ Cancel: CANCEL },
	);
}

// One cell of the menu, Primary or Alternate: only that device's keys count, the other device's are
// ignored. The action's one-field Capture above always writes Primary
export function RebindCell(
	action: InputActions.CaptureAction,
	device: InputActions.CapturableDevice,
	slot: Slot = "Primary",
): () => void {
	const binding = CellBinding(action, device, slot);
	if (binding === undefined) return () => {}; // no Alternate on this row
	return binding.Capture(
		"KeyCode",
		(key) => print(`${action.Name} (${device}, ${slot}) is now ${key?.Name ?? "unchanged"}`),
		{ Cancel: CANCEL },
	);
}

// An extra the schema declares is typed where it is: Jump's Alternate keys, emptied
export function ClearJumpAlternates() {
	Jump.Bindings.KeyboardAndMouse.Alt.Clear();
	Jump.Bindings.Gamepad.Alt.Clear();
}

// "Hold the keys, then let go" for a chord such as Ctrl+Shift+S (or LB + A on a gamepad): up to two
// modifiers and a key, all of the device whose key goes down first. Gameplay is held off meanwhile,
// so the keys don't also fire actions; the capture ends by itself after 5 s with the keys held then,
// or with nothing (the callback gets undefined then, and on a Cancel key)
export function RebindQuickSave(): () => void {
	const resumeGameplay = Input.Gameplay.Request(false);
	const stop = QuickSave.CaptureChord(
		(chord, device) => {
			resumeGameplay();
			if (chord === undefined || device === undefined) print("Quick save unchanged");
			else print(`Quick save is now ${QuickSave.Bindings[device].Describe()} on ${device}`);
		},
		{ Cancel: CANCEL, Timeout: 5 },
	);
	// closing the menu stops the capture; the callback isn't called then
	return () => {
		stop();
		resumeGameplay();
	};
}

// One direction of a composite, on the keyboard. A stick's direction (pushed past halfway) on the
// gamepad: Move.Bindings.Gamepad.Capture("KeyCode", ...) takes the whole stick pushed first
export function RebindForward(): () => void {
	return Move.Bindings.KeyboardAndMouse.Capture(
		"Up",
		(key) => print(key !== undefined ? `Forward is now ${key.Name}` : "Forward unchanged"),
		{ Cancel: CANCEL },
	);
}

// The wheel, mouse movement and touch gestures can't be pressed, so no capture takes them: offer
// them as choices and apply them with Set
export function UseTouchForJump() {
	Jump.Bindings.Touch.Set(Enum.KeyCode.TouchPosition); // a tap anywhere presses Jump
}

// A hint that shows Jump's key for the device in use (Space, or the gamepad's A button icon), and
// follows rebinds by itself: Roblox's InputActionLabel (a Studio beta in 2026-08)
export function ShowJumpHint(parent: GuiObject): () => void {
	const label = new Instance("InputActionLabel");
	label.Size = UDim2.fromOffset(120, 40);
	label.Parent = parent;
	const detach = Jump.AttachLabel(label);
	return () => {
		detach();
		label.Destroy();
	};
}

export function ResetAll() {
	Input.ResetBindings();
}

// Save: send this to the server, which cleans it with SanitizeBindings and stores it. It holds every
// device binding that differs from its defaults, also a gamepad key given to QuickSave; an Alternate
// key saves at its own path ("Gameplay/Jump/KeyboardAndMouse/Alt")
export function Save(): string {
	return Input.ExportBindings();
}

// Load: never throws; bad entries are skipped and stay at their defaults
export function Load(json: string) {
	const result = Input.ImportBindings(json);
	for (const skipped of result.Skipped)
		warn(`keybind ${skipped.Path} not loaded: ${skipped.Reason}`);
}

// server side, before storing a client's save:
//   const clean = InputActions.SanitizeBindings(InputSchema, jsonFromClient);
