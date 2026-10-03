// A settings screen: a column per device with the current keys, a one-field rebind per action,
// capturing a key or a chord into one device's binding, and saving and loading the rebinds.
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";

const InputSchema = InputActions.Schema({
	Gameplay: {
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.Space,
				Gamepad: Enum.KeyCode.ButtonA,
			}),
			// a chord: Ctrl+S; no gamepad key in the schema, but a player can give it one
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
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

/** Keys that close a capture without a change, from either device */
const CANCEL = [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB];

function KeyLabel(key: Enum.KeyCode | undefined) {
	return key === undefined ? "(unbound)" : UserInputService.GetStringForKeyCode(key);
}

/** "Ctrl + S": the modifiers, then the key */
function ChordLabel(keys: InputActions.BindingData<Enum.InputActionType.Bool>) {
	const parts = new Array<string>();
	if (keys.PrimaryModifier !== undefined) parts.push(KeyLabel(keys.PrimaryModifier));
	if (keys.SecondaryModifier !== undefined) parts.push(KeyLabel(keys.SecondaryModifier));
	parts.push(KeyLabel(keys.KeyCode));
	return parts.join(" + ");
}

/** The rows: one per action with a one-field capture (Bool and Direction1D actions) */
const ROWS: Array<[string, InputActions.CaptureAction]> = [
	["Jump", Jump],
	["Quick save", QuickSave],
	["Throttle", Throttle],
];

// Text labels refresh whenever a binding changes, whatever changed it. Each row shows its keys
// on both devices; the column of the device the player uses is marked
function RefreshLabels() {
	const preferred = InputActions.PreferredDevice();
	for (const [name, action] of ROWS) {
		const cells = COLUMNS.map((device) => {
			const keys = ChordLabel(
				action.Bindings[device].Get() as InputActions.BindingData<Enum.InputActionType.Bool>,
			);
			return device === preferred ? `[${keys}]` : keys;
		});
		print(`${name}: ${cells.join(" | ")}`);
	}
	print(
		`Forward: ${KeyLabel(Move.Bindings.KeyboardAndMouse.Get().Up)} | ${KeyLabel(Move.Bindings.Gamepad.Get().KeyCode)}`,
	);
}
Input.BindingsChanged.Connect(RefreshLabels);
UserInputService.GetPropertyChangedSignal("PreferredInput").Connect(RefreshLabels);
RefreshLabels();

/** Whether the menu offers rebinding at all: on a phone there are no keys to capture */
export function CanRebind() {
	return InputActions.PreferredDevice() !== "Touch";
}

// One field per action: "Press a key or a button for Jump". The first key pressed picks the
// device, and goes into that device's binding; the other device's binding is left alone
export function RebindAction(action: InputActions.CaptureAction): () => void {
	return action.Capture((key, device) => print(`${action.Name} is now ${key.Name} on ${device}`), {
		Cancel: CANCEL,
	});
}

// One cell of the two-column menu: only that device's keys count, the other device's are ignored
export function RebindCell(
	action: InputActions.CaptureAction,
	device: InputActions.CapturableDevice,
): () => void {
	return action.Bindings[device].Capture(
		"KeyCode",
		(key) => print(`${action.Name} (${device}) is now ${key.Name}`),
		{ Cancel: CANCEL },
	);
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
			else print(`Quick save is now ${ChordLabel(QuickSave.Bindings[device].Get())} on ${device}`);
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
	return Move.Bindings.KeyboardAndMouse.Capture("Up", (key) => print(`Forward is now ${key.Name}`));
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
// device binding that differs from its defaults, also a gamepad key given to QuickSave
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
