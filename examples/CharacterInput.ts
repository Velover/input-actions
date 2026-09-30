// A schema shared by both realms, the client handle, and the ways to read it.
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService } from "@rbxts/services";

// shared/InputSchema.ts: plain data, no instances
export const InputSchema = InputActions.Schema({
	Gameplay: {
		Priority: 2000, // above the default PlayerModule contexts
		Sink: true,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.Space,
				Gamepad: Enum.KeyCode.ButtonA,
			}),
			Sprint: InputActions.Bool(
				{ KeyboardAndMouse: Enum.KeyCode.LeftShift, Gamepad: Enum.KeyCode.ButtonL3 },
				{ TrackPrevious: true },
			),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable, // fed by an on-screen stick
			}),
			Throttle: InputActions.Direction1D({ Gamepad: Enum.KeyCode.ButtonR2 }),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});

// client
const Input = InputActions.Create(InputSchema);
const { Jump, Sprint, Move, Throttle } = Input.Gameplay.Actions;

Jump.Pressed.Connect(() => {
	Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid")?.ChangeState(
		Enum.HumanoidStateType.Jumping,
	);
});

RunService.RenderStepped.Connect(() => {
	const direction = Move.GetState(); // Vector2: X right, Y forward
	const speed = Throttle.GetState(); // number, 0..1 on a trigger
	if (Sprint.IsJustPressed()) print("sprint started");
	if (Sprint.IsJustReleased()) print("sprint stopped");
	return [direction, speed];
});

// An on-screen stick drives the Scriptable slot; fire zero when the finger lifts
export function OnVirtualStick(offset: Vector2) {
	Move.Bindings.Virtual.Fire(offset);
}

// Open the menu: its context takes over, gameplay pauses, until closeMenu()
export function OpenMenu() {
	const releaseUi = Input.Ui.Request(true);
	const releaseGameplay = Input.Gameplay.Request(false);
	Input.Ui.Actions.Cancel.Pressed.Once(() => {
		releaseUi();
		releaseGameplay();
	});
}
