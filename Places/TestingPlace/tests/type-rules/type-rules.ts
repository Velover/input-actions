// Compile-time rules of @rbxts/input-actions (design spec §3), ported from the type prototype.
// Every `@ts-expect-error` below must stay an error: when a rule stops holding, the directive is
// unused and `tsc -p tests/type-rules` fails, which fails `bun run build` and `bun run test`.
// Plain tsc checks it, not roblox-ts (which refuses these directives); nothing here runs.
import { InputActions } from "@rbxts/input-actions";

const Schema = InputActions.Schema({
	Gameplay: {
		ServerAuthority: true,
		Priority: 2000,
		Sink: true,
		Actions: {
			Jump: InputActions.Bool({ Keyboard: Enum.KeyCode.Space, Gamepad: Enum.KeyCode.ButtonA }),
			Fire: InputActions.Bool({
				Mouse: Enum.KeyCode.MouseLeftButton,
				Gamepad: { KeyCode: Enum.KeyCode.ButtonR2, PressedThreshold: 0.6 },
			}),
			Move: InputActions.Direction2D({
				Keyboard: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Look: InputActions.Direction2D({
				Mouse: { KeyCode: Enum.KeyCode.MouseDelta, Scale: 0.01 },
				Gamepad: Enum.KeyCode.Thumbstick2,
			}),
			Zoom: InputActions.Direction1D({
				Mouse: Enum.KeyCode.MouseWheel,
				Gamepad: { Up: Enum.KeyCode.DPadUp, Down: Enum.KeyCode.DPadDown },
			}),
			Fly: InputActions.Direction3D({
				Keyboard: {
					Forward: Enum.KeyCode.W,
					Backward: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
					Up: Enum.KeyCode.Space,
					Down: Enum.KeyCode.LeftControl,
				},
			}),
			Aim: InputActions.ViewportPosition({ Pointer: Enum.KeyCode.MousePosition }),
			QuickSave: InputActions.Bool({
				Keyboard: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
			}),
			Dash: InputActions.Bool(),
			Crouch: InputActions.Bool({ Keyboard: Enum.KeyCode.C }, { TrackPrevious: true }),
			Steer: InputActions.Direction1D({ Gamepad: Enum.KeyCode.ButtonR2 }, { TrackPrevious: true }),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true }),
});

/** A helper a user project would write: takes any Bool action */
function holdWhile(action: InputActions.BoolAction) {
	return action.IsPressed();
}

export function TypeRules() {
	// Each rule below must stay on one line after its directive: keep them under the print width
	const K = Enum.KeyCode;
	const Input = InputActions.Create(Schema);
	const { Jump, Move, Look, Crouch, Steer, Fly, Aim, Zoom, Dash } = Input.Gameplay.Actions;

	// ---- what must compile, with the value types it must have
	const crouchStarted: boolean = Crouch.IsJustPressed();
	const crouchEnded: boolean = Crouch.IsJustReleased();
	const steerBefore: number = Steer.GetPrevious();
	const steerMoved: boolean = Steer.HasChanged();
	const moveState: Vector2 = Move.GetState();
	const flyState: Vector3 = Fly.GetState();
	const aimState: Vector2 = Aim.GetState();
	const zoomState: number = Zoom.GetState();
	const navigate: Vector2 = Input.Ui.Actions.Navigate.GetState();
	const scroll: number = Input.Ui.Actions.Scroll.GetState();
	Move.StateChanged.Connect((value: Vector2) => value.Magnitude);
	Jump.Pressed.Connect(() => {});
	Jump.Bindings.Keyboard.Set(Enum.KeyCode.F);
	Move.Bindings.Keyboard.Set({ Up: Enum.KeyCode.Up, Down: Enum.KeyCode.Down });
	Move.Bindings.Virtual.Fire(new Vector2(0, 1));
	Move.Fire(Vector2.zero);
	Dash.Fire(true);
	Jump.Bindings.Keyboard.Capture("KeyCode", (key: Enum.KeyCode) => key, {
		Cancel: [Enum.KeyCode.Backspace],
	});
	Move.Bindings.Keyboard.Capture("Left", () => {});
	const release: () => void = Input.Ui.Request(true);
	const linked: boolean = Input.Gameplay.IsLinkedToServer(); // a Server Authority context
	Input.Gameplay.LinkedToServer.Connect(() => {});
	const saved: string = Input.ExportBindings();
	const applied: string[] = Input.ImportBindings(saved).Applied;
	holdWhile(Jump);
	holdWhile(Crouch); // tracked Bool actions still fit project helpers
	holdWhile(Input.Ui.Actions.Accept);

	const player = undefined as unknown as Player;
	const server = InputActions.ForPlayer(Schema, player);
	const serverMove: Vector2 = server.Gameplay.Actions.Move.GetState();
	const serverJump: boolean = server.Gameplay.Actions.Jump.GetState();
	server.Gameplay.Actions.Jump.Pressed.Connect(() => {});

	// ---- things that must NOT compile

	// @ts-expect-error mouse movement can't drive a Bool action
	InputActions.Bool({ Mouse: Enum.KeyCode.MouseDelta });
	// @ts-expect-error mouse wheel can't drive a Bool action
	InputActions.Bool({ Mouse: Enum.KeyCode.MouseWheel });
	// @ts-expect-error a thumbstick is 2D, not Bool
	InputActions.Bool({ Gamepad: Enum.KeyCode.Thumbstick1 });
	// @ts-expect-error Escape is reserved by Roblox
	InputActions.Bool({ Keyboard: Enum.KeyCode.Escape });
	// @ts-expect-error deprecated KeyCode
	InputActions.Bool({ Mouse: Enum.KeyCode.MouseX });
	// @ts-expect-error None can't be written in a schema
	InputActions.Bool({ Keyboard: Enum.KeyCode.None });
	// @ts-expect-error a plain key can't drive a Direction2D KeyCode (use Up/Down/Left/Right)
	InputActions.Direction2D({ Keyboard: Enum.KeyCode.W });
	// @ts-expect-error mouse position can't be a direction
	InputActions.Direction2D({ Mouse: Enum.KeyCode.MousePosition });
	// @ts-expect-error mouse delta can't be a composite direction
	InputActions.Direction2D({ Mouse: { Up: Enum.KeyCode.MouseDelta } });
	// @ts-expect-error KeyCode and composite directions can't share a binding
	InputActions.Direction2D({ Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, Up: Enum.KeyCode.W } });
	// @ts-expect-error ResponseCurve only applies to thumbsticks
	InputActions.Direction2D({ Mouse: { KeyCode: Enum.KeyCode.MouseDelta, ResponseCurve: 2 } });
	// @ts-expect-error Left/Right aren't valid on Direction1D
	InputActions.Direction1D({ Keyboard: { Up: Enum.KeyCode.W, Left: Enum.KeyCode.A } });
	// @ts-expect-error thresholds only exist on Bool bindings
	InputActions.Direction1D({ Gamepad: { KeyCode: Enum.KeyCode.ButtonR2, PressedThreshold: 0.5 } });
	// @ts-expect-error Direction3D takes composites only
	InputActions.Direction3D({ Gamepad: Enum.KeyCode.Thumbstick1 });
	// @ts-expect-error ViewportPosition only takes MousePosition/TouchPosition
	InputActions.ViewportPosition({ Mouse: Enum.KeyCode.MouseDelta });
	// @ts-expect-error ViewportPosition bindings have no modifiers
	InputActions.ViewportPosition({ Mouse: { KeyCode: K.MousePosition, PrimaryModifier: K.E } });
	// @ts-expect-error a mouse delta can't be a modifier
	InputActions.Bool({ Keyboard: { KeyCode: K.E, PrimaryModifier: K.MouseDelta } });
	// @ts-expect-error UIButton never appears in the schema (AttachButton adds it at runtime)
	InputActions.Bool({ Touch: { KeyCode: Enum.KeyCode.E, UIButton: new Instance("TextButton") } });
	// @ts-expect-error an unknown property is rejected
	InputActions.Bool({ Keyboard: { KeyCode: Enum.KeyCode.E, Sensitivity: 2 } });
	// @ts-expect-error rebinding follows the same rules
	Jump.Bindings.Keyboard.Set(Enum.KeyCode.MouseDelta);
	// @ts-expect-error rebinding a Direction2D binding to a plain key
	Look.Bindings.Mouse.Set(Enum.KeyCode.E);
	// @ts-expect-error a Scriptable binding has no Set
	Move.Bindings.Virtual.Set(Enum.KeyCode.Thumbstick1);
	// @ts-expect-error a key binding has no Fire
	Move.Bindings.Keyboard.Fire(Vector2.zero);
	// @ts-expect-error Fire takes the action's value type
	Jump.Fire(0.5);
	// @ts-expect-error Fire takes the action's value type
	Move.Bindings.Virtual.Fire(true);
	// @ts-expect-error Capture only takes the slots of the action type
	Jump.Bindings.Keyboard.Capture("Up", () => {});
	// @ts-expect-error unknown binding names are compile errors
	Jump.Bindings.Touch.Set(Enum.KeyCode.E);
	// @ts-expect-error unknown action names are compile errors
	Input.Gameplay.Actions.Sprint.GetState();
	// @ts-expect-error unknown context names are compile errors
	Input.Vehicle.SetEnabled(true);
	// @ts-expect-error AttachButton only exists on Bool actions
	Move.AttachButton(new Instance("TextButton"));
	// @ts-expect-error Pressed only exists on Bool actions
	Move.Pressed.Connect(() => {});
	// @ts-expect-error project helpers taking Bool actions reject other types
	holdWhile(Move);
	// @ts-expect-error IsJustPressed needs TrackPrevious: true
	Jump.IsJustPressed();
	// @ts-expect-error GetPrevious needs TrackPrevious: true
	Move.GetPrevious();
	// @ts-expect-error IsJustPressed is Bool-only even when tracked
	Steer.IsJustPressed();
	// @ts-expect-error only Server Authority contexts link to a server copy
	Input.Ui.IsLinkedToServer();
	// @ts-expect-error Ui isn't marked ServerAuthority, so the server can't see it
	server.Ui.Actions.Accept.GetState();
	// @ts-expect-error the server has no keybind info
	server.Gameplay.Actions.Jump.Bindings;
	// @ts-expect-error the server only reads input
	server.Gameplay.Actions.Jump.Fire(true);
	// @ts-expect-error Pressed only exists on the server's Bool actions
	server.Gameplay.Actions.Move.Pressed.Connect(() => {});

	return [
		crouchStarted,
		crouchEnded,
		steerBefore,
		steerMoved,
		moveState,
		flyState,
		aimState,
		zoomState,
		navigate,
		scroll,
		release,
		linked,
		applied,
		serverMove,
		serverJump,
	];
}
