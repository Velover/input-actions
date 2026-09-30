// Validator round 1: extra compile-time rules (design spec section 3), checked by plain tsc beside
// type-rules.ts. Each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const Extra = InputActions.Schema({
	Ui: InputActions.Presets.UiNavigation({ ServerAuthority: true }),
	Tools: {
		Actions: {
			Fly: InputActions.Direction3D({ Keys: { Up: K.E } }),
			Aim: InputActions.ViewportPosition({ Pointer: K.MousePosition }),
		},
	},
});

export function ValidatorR1TypeRules() {
	const Input = InputActions.Create(Extra);
	const player = undefined as unknown as Player;
	const { Accept, Navigate, Scroll } = Input.Ui.Actions;
	const { Fly, Aim } = Input.Tools.Actions;
	const accept = Accept.Bindings.KeyboardAndMouse;
	const navigate = Navigate.Bindings.KeyboardAndMouse;

	// ---- what must compile
	InputActions.Bool({ Touch: K.TouchPosition });
	InputActions.Bool({ Pad: { KeyCode: K.ButtonR2, PressedThreshold: 0.3, ReleasedThreshold: 0.1 } });
	InputActions.Direction1D({ Pinch: K.TouchPinch, Trigger: K.ButtonL2, Key: K.E });
	InputActions.Direction2D({ Pan: { KeyCode: K.TrackpadPan, Vector2Scale: new Vector2(1, 1) } });
	InputActions.Direction2D({ Keys: { Up: K.Thumbstick1Up, Down: K.ButtonL2, PrimaryModifier: K.LeftShift } });
	InputActions.Direction3D({ Keys: { Up: K.E, Vector3Scale: new Vector3(1, 1, 1), Scale: 2 } });
	InputActions.ViewportPosition({ Touch: K.TouchPosition });
	// a preset marked ServerAuthority is as precise as a hand-written schema, on both realms
	const linked: boolean = Input.Ui.IsLinkedToServer();
	const serverNavigate: Vector2 = InputActions.ForPlayer(Extra, player).Ui.Actions.Navigate.GetState();
	Scroll.Bindings.Mouse.Set(K.MouseWheel);
	navigate.Set({ Up: K.I });

	// ---- things that must NOT compile
	// @ts-expect-error Scale is not a Bool property
	InputActions.Bool({ K: { KeyCode: K.E, Scale: 2 } });
	// @ts-expect-error Direction3D has no KeyCode
	InputActions.Direction3D({ K: { KeyCode: K.E } });
	// @ts-expect-error mouse buttons aren't modifiers
	InputActions.Bool({ K: { KeyCode: K.E, PrimaryModifier: K.MouseLeftButton } });
	// @ts-expect-error an axis isn't a modifier
	InputActions.Bool({ K: { KeyCode: K.E, SecondaryModifier: K.ButtonL2 } });
	// @ts-expect-error MousePosition doesn't drive a Bool
	InputActions.Bool({ K: K.MousePosition });
	// @ts-expect-error a stick doesn't drive a Direction1D
	InputActions.Direction1D({ K: K.Thumbstick1 });
	// @ts-expect-error a 2D delta doesn't drive a Direction1D
	InputActions.Direction1D({ K: K.MouseDelta });
	// @ts-expect-error ViewportPosition has no Scale
	InputActions.ViewportPosition({ K: { KeyCode: K.MousePosition, Scale: 1 } });
	// @ts-expect-error a Bool object needs its KeyCode
	InputActions.Bool({ K: { PressedThreshold: 0.5 } });
	// @ts-expect-error F9 is reserved
	InputActions.Bool({ K: { KeyCode: K.F9 } });
	// @ts-expect-error Forward is a Direction3D composite only
	InputActions.Direction2D({ K: { Forward: K.W } });
	// @ts-expect-error an unknown property on a composite
	InputActions.Direction2D({ K: { Up: K.W, Foo: 1 } });
	// @ts-expect-error ResponseCurve on a composite
	InputActions.Direction2D({ K: { Up: K.W, ResponseCurve: 2 } });
	// @ts-expect-error Vector3Scale on a Direction2D
	InputActions.Direction2D({ K: { KeyCode: K.Thumbstick1, Vector3Scale: new Vector3() } });
	// @ts-expect-error a Direction1D key binding with a composite
	InputActions.Direction1D({ K: { KeyCode: K.MouseWheel, Up: K.W } });
	// @ts-expect-error UIButton never appears in a schema, on a composite either
	InputActions.Direction2D({ K: { Up: K.W, UIButton: new Instance("TextButton") } });
	// @ts-expect-error a DisplayImage is a string
	InputActions.Bool({ K: { KeyCode: K.E, DisplayImage: 5 } });
	// @ts-expect-error Scriptable is not a binding shape for Set
	accept.Set(InputActions.Scriptable);
	// @ts-expect-error Set with an unknown property
	accept.Set({ KeyCode: K.E, Foo: 1 });
	// @ts-expect-error Set cannot write None (Clear unbinds)
	accept.Set(K.None);
	// @ts-expect-error Set: ResponseCurve on a delta key
	navigate.Set({ KeyCode: K.MouseDelta, ResponseCurve: 2 });
	// @ts-expect-error Set: a Direction3D binding has no KeyCode
	Fly.Bindings.Keys.Set({ KeyCode: K.W });
	// @ts-expect-error Capture: ViewportPosition bindings have no modifier slots
	Aim.Bindings.Pointer.Capture("PrimaryModifier", () => {});
	// @ts-expect-error Released only exists on Bool actions
	Navigate.Released.Connect(() => {});
	// @ts-expect-error Tap only exists on Bool actions
	Scroll.Tap();
	// @ts-expect-error HasChanged needs TrackPrevious: true
	Accept.HasChanged();
	// @ts-expect-error the server's handle has no Tools (not Server Authority)
	InputActions.ForPlayer(Extra, player).Tools.Actions.Aim.GetState();

	return [linked, serverNavigate];
}
