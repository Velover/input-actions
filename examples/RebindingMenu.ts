// A settings screen: show the current keys, capture a new one, save and load the rebinds.
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";

const InputSchema = InputActions.Schema({
	Gameplay: {
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.Space,
				Gamepad: Enum.KeyCode.ButtonA,
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
const moveKeys = Input.Gameplay.Actions.Move.Bindings.KeyboardAndMouse;

function KeyLabel(key: Enum.KeyCode | undefined) {
	return key === undefined ? "(unbound)" : UserInputService.GetStringForKeyCode(key);
}

// Labels refresh whenever a binding changes, whatever changed it
function RefreshLabels() {
	print(`Jump: ${KeyLabel(jumpKey.Get().KeyCode)}`);
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

// One direction of a composite
export function RebindForward(): () => void {
	return moveKeys.Capture("Up", (key) => print(`Forward is now ${key.Name}`));
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
