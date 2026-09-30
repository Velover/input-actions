// Validator round 6: compile-time rules not covered by the other files (design spec sections 3, 6,
// 8 and 9), checked by plain tsc. Each rule stays on the one line after its directive.
import { InputActions, InputCatcher, RawInputHandler } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const R6 = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ Keys: K.Space }),
			Lean: InputActions.Direction1D({ Axis: K.ButtonL2, Keys: { Up: K.E, Down: K.Q } }),
			Look: InputActions.Direction2D({ Mouse: { KeyCode: K.MouseDelta, Vector2Scale: new Vector2(1, -1) } }),
			Fly: InputActions.Direction3D({ Keys: { Up: K.Space, Down: K.LeftControl } }),
			Aim: InputActions.ViewportPosition({ Pointer: K.MousePosition }),
		},
	},
	Menu: InputActions.Presets.UiNavigation({ ServerAuthority: false }),
	Shared: InputActions.Presets.UiNavigation({ ServerAuthority: true, Enabled: false }),
});

export function ValidatorR6TypeRules() {
	const Input = InputActions.Create(R6);
	const player = undefined as unknown as Player;
	const server = InputActions.ForPlayer(R6, player);
	const { Jump, Lean, Look, Fly, Aim } = Input.Play.Actions;

	// ---- what must compile, with the types it must have
	const leanData: number | undefined = Lean.Bindings.Axis.Get().Scale;
	const lookScale: Vector2 | undefined = Look.Bindings.Mouse.Get().Vector2Scale;
	const flyScale: Vector3 | undefined = Fly.Bindings.Keys.Get().Vector3Scale;
	const jumpThreshold: number | undefined = Jump.Bindings.Keys.Get().PressedThreshold;
	Lean.Bindings.Axis.Set(K.Thumbstick1Up);
	Lean.Bindings.Axis.Set(K.TouchPinch);
	Aim.Bindings.Pointer.Capture("KeyCode", () => {});
	const release: () => void = Input.Shared.Request(true);
	const linked: boolean = Input.Shared.IsLinkedToServer();
	const accept: boolean = server.Shared.Actions.Accept.GetState();
	const catcher = new InputCatcher(100);
	const active: boolean = catcher.IsActive();
	const move: Vector3 = RawInputHandler.GetMoveVector(true, true, false);
	const zoom: number = RawInputHandler.GetZoomDelta();
	const rotation: Vector2 = RawInputHandler.GetRotation();

	// ---- things that must NOT compile

	// @ts-expect-error a mouse button doesn't drive a Direction1D KeyCode (Button, Axis, Delta1D only)
	InputActions.Direction1D({ K: K.MouseLeftButton });
	// @ts-expect-error TouchPosition doesn't drive a Direction1D
	InputActions.Direction1D({ K: K.TouchPosition });
	// @ts-expect-error a mouse button is not a Direction1D KeyCode in Set either
	Lean.Bindings.Axis.Set(K.MouseRightButton);
	// @ts-expect-error a Direction3D binding has no KeyCode slot to capture
	Fly.Bindings.Keys.Capture("KeyCode", () => {});
	// @ts-expect-error a Bool binding's data has no Scale
	Jump.Bindings.Keys.Get().Scale;
	// @ts-expect-error a Direction1D binding's data has no Vector2Scale
	Lean.Bindings.Axis.Get().Vector2Scale;
	// @ts-expect-error a ViewportPosition binding's data has no modifier
	Aim.Bindings.Pointer.Get().PrimaryModifier;
	// @ts-expect-error a preset marked ServerAuthority: false has no IsLinkedToServer
	Input.Menu.IsLinkedToServer();
	// @ts-expect-error a preset marked ServerAuthority: false is not on the server's handle
	server.Menu.Actions.Accept.GetState();
	// @ts-expect-error a Direction3D Set takes no Vector2Scale
	Fly.Bindings.Keys.Set({ Up: K.E, Vector2Scale: new Vector2(1, 1) });
	// @ts-expect-error Clear on a key binding takes only a slot name
	Jump.Bindings.Keys.Clear("Scale");
	// @ts-expect-error TouchPosition is not a modifier
	InputActions.Bool({ K: { KeyCode: K.E, PrimaryModifier: K.TouchPosition } });
	// @ts-expect-error a thumbstick is not a modifier
	InputActions.Direction2D({ K: { Up: K.W, SecondaryModifier: K.Thumbstick2 } });
	// @ts-expect-error a stick is not a composite of a Direction3D
	InputActions.Direction3D({ K: { Backward: K.Thumbstick2 } });
	// @ts-expect-error Direction3D takes no bare key in Set, even a composite key
	Fly.Bindings.Keys.Set(K.Space);
	// @ts-expect-error the root handle's Destroy takes nothing and returns nothing usable
	const destroyed: string = Input.Destroy();
	// @ts-expect-error ForPlayer takes a Player
	InputActions.ForPlayer(R6, "player");
	// @ts-expect-error a handle's Actions are read-only
	Input.Play.Actions.Jump = Input.Play.Actions.Jump;
	// @ts-expect-error AttachButton takes a GuiButton, not any GuiObject
	Jump.AttachButton(new Instance("TextLabel"));
	// @ts-expect-error the server's handle has no Request
	server.Shared.Request(true);

	return [leanData, lookScale, flyScale, jumpThreshold, release, linked, accept, active, move, zoom, rotation, destroyed];
}
