// Validator round 3: compile-time rules not covered by type-rules.ts or validator-r1-type-rules.ts
// (design spec sections 3, 6, 8). Checked by plain tsc; each rule stays on the one line after its
// directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const R3 = InputActions.Schema({
	Play: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: K.Space,
				Gamepad: { KeyCode: K.ButtonR2, PressedThreshold: 0.4 },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: { KeyCode: K.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Fly: InputActions.Direction3D({ KeyboardAndMouse: { Up: K.E, Forward: K.W } }, { TrackPrevious: true }),
			Aim: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition }),
			Throttle: InputActions.Direction1D({ Gamepad: K.ButtonR2, Virtual: InputActions.Scriptable }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
		},
	},
	Menu: { Actions: { Open: InputActions.Bool({ KeyboardAndMouse: K.M }) } },
});

export function ValidatorR3TypeRules() {
	const Input = InputActions.Create(R3);
	const player = undefined as unknown as Player;
	const server = InputActions.ForPlayer(R3, player);
	const { Jump, Move, Fly, Aim, Throttle, Crouch } = Input.Play.Actions;

	// ---- what must compile, with the types it must have
	const flyBefore: Vector3 = Fly.GetPrevious();
	const crouchBefore: boolean = Crouch.GetPrevious();
	const throttleVirtual = (value: number) => Throttle.Bindings.Virtual.Fire(value);
	const padData = Jump.Bindings.Gamepad.Get();
	const threshold: number | undefined = padData.PressedThreshold;
	const stickCurve: number | undefined = Move.Bindings.Gamepad.Get().ResponseCurve;
	const stop: () => void = InputActions.ProvideToPlayers(R3);
	const clean: string = InputActions.SanitizeBindings(R3, "{}");
	const skipped: string = Input.Play.ImportBindings("{}").Skipped[0].Reason;
	// an object without KeyCode merges into a stick binding through the composite shape (Scale only)
	Move.Bindings.Gamepad.Set({ Scale: 2 });
	Move.Bindings.Gamepad.Set({ KeyCode: K.Thumbstick2, ResponseCurve: 3 });
	Fly.Bindings.KeyboardAndMouse.Clear("Forward");
	Fly.Bindings.KeyboardAndMouse.Capture("Backward", () => {});
	server.Play.Actions.Jump.Released.Connect(() => {});
	server.Play.Actions.Move.StateChanged.Connect((value: Vector2) => value.X);
	const serverFly: Vector3 = server.Play.Actions.Fly.GetState();
	const action: InputActions.Action<Enum.InputActionType.Direction2D> = Move;
	const bool: InputActions.BoolAction = Input.Menu.Actions.Open;

	// ---- things that must NOT compile
	// @ts-expect-error a mouse button can't be a composite direction
	InputActions.Direction2D({ KeyboardAndMouse: { Up: K.MouseLeftButton } });
	// @ts-expect-error a delta can't be a composite direction of a Direction3D either
	InputActions.Direction3D({ KeyboardAndMouse: { Forward: K.MouseWheel } });
	// @ts-expect-error Direction1D has no Vector2Scale
	InputActions.Direction1D({ KeyboardAndMouse: { KeyCode: K.MouseWheel, Vector2Scale: new Vector2(1, 1) } });
	// @ts-expect-error a stick binding can't take a composite direction in Set either
	Move.Bindings.Gamepad.Set({ KeyCode: K.Thumbstick1, Up: K.DPadUp });
	// @ts-expect-error ResponseCurve alone: the stick shape needs its KeyCode
	Move.Bindings.Gamepad.Set({ ResponseCurve: 3 });
	// @ts-expect-error a Scriptable binding has no Get
	Move.Bindings.Virtual.Get();
	// @ts-expect-error a Scriptable binding has no Reset
	Move.Bindings.Virtual.Reset();
	// @ts-expect-error a Scriptable binding has no Capture
	Throttle.Bindings.Virtual.Capture("KeyCode", () => {});
	// @ts-expect-error a Scriptable binding's Fire takes the action's value type
	Throttle.Bindings.Virtual.Fire(new Vector2());
	// @ts-expect-error Direction3D has no KeyCode slot to clear
	Fly.Bindings.KeyboardAndMouse.Clear("KeyCode");
	// @ts-expect-error Forward is not a Direction2D slot
	Move.Bindings.KeyboardAndMouse.Capture("Forward", () => {});
	// @ts-expect-error ViewportPosition has no composite slot
	Aim.Bindings.KeyboardAndMouse.Clear("Up");
	// @ts-expect-error IsJustReleased is Bool-only even when tracked
	Fly.IsJustReleased();
	// @ts-expect-error a context that is not Server Authority has no LinkedToServer
	Input.Menu.LinkedToServer.Connect(() => {});
	// @ts-expect-error the server's actions have no IsPressed
	server.Play.Actions.Jump.IsPressed();
	// @ts-expect-error Released only exists on the server's Bool actions
	server.Play.Actions.Move.Released.Connect(() => {});
	// @ts-expect-error the server's handle has no Menu (not Server Authority)
	server.Menu.Instance;
	// @ts-expect-error a Direction2D action is not a Direction1D action
	const wrong: InputActions.Action<Enum.InputActionType.Direction1D> = Move;
	// @ts-expect-error a builder option that doesn't exist
	InputActions.Bool({ KeyboardAndMouse: K.E }, { TrackPrevios: true });

	return [flyBefore, crouchBefore, throttleVirtual, threshold, stickCurve, stop, clean, skipped];
}
