// A settings screen: show the current keys, capture a new key or a chord, save and load the rebinds.
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";

const InputSchema = InputActions.Schema({
	Gameplay: {
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.Space,
				Gamepad: Enum.KeyCode.ButtonA,
			}),
			// a chord: Ctrl+S
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
			}),
		},
	},
});

const Input = InputActions.Create(InputSchema);
const jumpKey = Input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
const quickSaveKeys = Input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
const moveKeys = Input.Gameplay.Actions.Move.Bindings.KeyboardAndMouse;

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

// Text labels refresh whenever a binding changes, whatever changed it
function RefreshLabels() {
	print(`Jump: ${KeyLabel(jumpKey.Get().KeyCode)}`);
	print(`Quick save: ${ChordLabel(quickSaveKeys.Get())}`);
	print(`Forward: ${KeyLabel(moveKeys.Get().Up)}`);
}
Input.BindingsChanged.Connect(RefreshLabels);
RefreshLabels();

// "Press a key for Jump" (Backspace cancels): only keys a Bool action accepts are taken
export function RebindJump(): () => void {
	return jumpKey.Capture("KeyCode", (key) => print(`Jump is now ${key.Name}`), {
		Cancel: [Enum.KeyCode.Backspace],
	});
}

// "Hold the keys, then let go" for a chord such as Ctrl+Shift+S: up to two modifiers and a key.
// Gameplay is held off meanwhile, so the keys don't also fire actions; the capture ends by itself
// after 5 s with the keys held then, or with nothing (the callback gets undefined then, and on
// Backspace)
export function RebindQuickSave(): () => void {
	const resumeGameplay = Input.Gameplay.Request(false);
	const stop = quickSaveKeys.CaptureChord(
		(chord) => {
			resumeGameplay();
			if (chord === undefined) print("Quick save unchanged");
			else print(`Quick save is now ${ChordLabel(quickSaveKeys.Get())}`);
		},
		{ Cancel: [Enum.KeyCode.Backspace], Timeout: 5 },
	);
	// closing the menu stops the capture; the callback isn't called then
	return () => {
		stop();
		resumeGameplay();
	};
}

// One direction of a composite
export function RebindForward(): () => void {
	return moveKeys.Capture("Up", (key) => print(`Forward is now ${key.Name}`));
}

// A hint that shows Jump's key for the device in use (Space, or the gamepad's A button icon), and
// follows rebinds by itself: Roblox's InputActionLabel (a Studio beta in 2026-08)
export function ShowJumpHint(parent: GuiObject): () => void {
	const label = new Instance("InputActionLabel");
	label.Size = UDim2.fromOffset(120, 40);
	label.Parent = parent;
	const detach = Input.Gameplay.Actions.Jump.AttachLabel(label);
	return () => {
		detach();
		label.Destroy();
	};
}

export function ResetAll() {
	Input.ResetBindings();
}

// Save: send this to the server, which cleans it with SanitizeBindings and stores it
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
