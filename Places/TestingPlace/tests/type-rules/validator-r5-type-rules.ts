// Validator round 5: compile-time rules not covered by the other files (design spec sections 3, 6,
// 8 and 9), checked by plain tsc. Each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const R5 = InputActions.Schema({
	Play: {
		Actions: {
			Jump: InputActions.Bool({ Keys: K.Space, Pad: { KeyCode: K.ButtonR2, PressedThreshold: 0.4 } }),
			Fly: InputActions.Direction3D({ Keys: { Up: K.E, Forward: K.W } }),
			Aim: InputActions.ViewportPosition({ Pointer: K.MousePosition, Virtual: InputActions.Scriptable }),
			Zoom: InputActions.Direction1D({ Wheel: K.MouseWheel }, { TrackPrevious: true }),
			Look: InputActions.Direction2D({ Stick: K.Thumbstick2 }),
		},
	},
	Local: { ServerAuthority: false, Actions: { Wave: InputActions.Bool({ Keys: K.G }) } },
	Shared: { ServerAuthority: true, Actions: { Nod: InputActions.Bool({ Keys: K.N }) } },
	Menu: InputActions.Presets.UiNavigation({ Priority: 3000 }),
});

export function ValidatorR5TypeRules() {
	const Input = InputActions.Create(R5);
	const player = undefined as unknown as Player;
	const server = InputActions.ForPlayer(R5, player);
	const { Jump, Fly, Aim, Zoom, Look } = Input.Play.Actions;

	// ---- what must compile, with the types it must have
	Aim.Bindings.Pointer.Set(K.TouchPosition);
	Aim.Bindings.Virtual.Fire(new Vector2(10, 20));
	Fly.Bindings.Keys.Set({ Forward: K.Thumbstick1Up, Backward: K.ButtonL2 });
	Jump.Bindings.Pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.3, ReleasedThreshold: 0.1 });
	Jump.Bindings.Keys.Set({ KeyCode: K.E, PrimaryModifier: K.LeftShift, DisplayName: "Jump" });
	const zoomBefore: number = Zoom.GetPrevious();
	const menu: InputActions.ContextHandle<InputActions.Presets.UiNavigationSchema> = Input.Menu;
	const linked: boolean = Input.Shared.IsLinkedToServer();
	const nod: boolean = server.Shared.Actions.Nod.GetState();
	const jump: InputActions.ActionHandle<typeof R5.Contexts.Play.Actions.Jump> = Jump;
	const lookData: Vector2 | undefined = Look.Bindings.Stick.Get().Vector2Scale;

	// ---- things that must NOT compile
	// @ts-expect-error a bare key is not a Direction3D binding (six composites only)
	InputActions.Direction3D({ K: K.W });
	// @ts-expect-error Set with a bare key on a Direction3D binding
	Fly.Bindings.Keys.Set(K.W);
	// @ts-expect-error a ViewportPosition binding has no modifier slot to clear
	Aim.Bindings.Pointer.Clear("PrimaryModifier");
	// @ts-expect-error a Direction1D binding has no Left slot to clear
	Zoom.Bindings.Wheel.Clear("Left");
	// @ts-expect-error StateChanged passes the action's value type
	Jump.StateChanged.Connect((value: number) => value);
	// @ts-expect-error the server's StateChanged passes the action's value type too
	server.Shared.Actions.Nod.StateChanged.Connect((value: Vector2) => value);
	// @ts-expect-error a ViewportPosition action fires a Vector2
	Aim.Fire(new Vector3());
	// @ts-expect-error a ViewportPosition binding has no Scale
	Aim.Bindings.Pointer.Set({ KeyCode: K.MousePosition, Scale: 2 });
	// @ts-expect-error a Bool binding has no Scale, in Set either
	Jump.Bindings.Keys.Set({ KeyCode: K.E, Scale: 2 });
	// @ts-expect-error EnabledChanged passes a boolean
	Input.Play.EnabledChanged.Connect((value: number) => value);
	// @ts-expect-error Request takes a boolean
	Input.Play.Request("yes");
	// @ts-expect-error a builder's DisplayName is a string
	InputActions.Bool({ K: K.E }, { DisplayName: 5 });
	// @ts-expect-error a builder's Enabled is a boolean
	InputActions.Bool({ K: K.E }, { Enabled: "no" });
	// @ts-expect-error Capture's callback takes the key
	Jump.Bindings.Keys.Capture("KeyCode", (key: string) => key);
	// @ts-expect-error a Direction3D action is not a Bool action
	const notBool: InputActions.BoolAction = Fly;
	// @ts-expect-error the preset's actions have only its own slots
	Input.Menu.Actions.Scroll.Bindings.Touch.Set(K.MouseWheel);
	// @ts-expect-error a Vector3 is not a Vector2Scale
	InputActions.Direction2D({ K: { KeyCode: K.Thumbstick1, Vector2Scale: new Vector3() } });
	// @ts-expect-error a ViewportPosition binding takes no composite
	InputActions.ViewportPosition({ K: { Up: K.W } });
	// @ts-expect-error a Direction1D binding has no Vector3Scale
	InputActions.Direction1D({ K: { KeyCode: K.MouseWheel, Vector3Scale: new Vector3() } });
	// @ts-expect-error a Bool binding has no ResponseCurve
	InputActions.Bool({ K: { KeyCode: K.ButtonR2, ResponseCurve: 2 } });
	// @ts-expect-error Tap only exists on Bool actions, tracked or not
	Zoom.Tap();
	// @ts-expect-error a stick is not a composite key
	InputActions.Direction1D({ K: { Up: K.Thumbstick1 } });
	// @ts-expect-error a wheel is not a composite key
	InputActions.Direction2D({ K: { Up: K.MouseWheel } });
	// @ts-expect-error a reserved key is not a modifier
	InputActions.Bool({ K: { KeyCode: K.E, SecondaryModifier: K.Escape } });
	// @ts-expect-error ButtonStart is reserved
	InputActions.Bool({ K: K.ButtonStart });
	// @ts-expect-error Print is reserved
	InputActions.Bool({ K: K.Print });
	// @ts-expect-error F11 is reserved, in a composite too
	InputActions.Direction2D({ K: { Up: K.F11 } });
	// @ts-expect-error a deprecated key is not a modifier
	InputActions.Bool({ K: { KeyCode: K.E, PrimaryModifier: K.MouseNoButton } });
	// @ts-expect-error Set cannot write None into a modifier
	Jump.Bindings.Keys.Set({ KeyCode: K.E, PrimaryModifier: K.None });
	// @ts-expect-error Unknown is None
	Jump.Bindings.Keys.Set(K.Unknown);
	// @ts-expect-error Create's Timeout is a number
	InputActions.Create(R5, { Timeout: "10" });
	// @ts-expect-error Create's ResetOnFocusLoss is a boolean
	InputActions.Create(R5, { ResetOnFocusLoss: 1 });
	// @ts-expect-error SanitizeBindings takes the saved JSON string
	InputActions.SanitizeBindings(R5, 5);
	// @ts-expect-error a context marked ServerAuthority: false has no IsLinkedToServer
	Input.Local.IsLinkedToServer();
	// @ts-expect-error a context marked ServerAuthority: false is not on the server's handle
	server.Local.Actions.Wave.GetState();
	// @ts-expect-error a Scriptable ViewportPosition slot fires a Vector2
	Aim.Bindings.Virtual.Fire(true);

	return [zoomBefore, menu, linked, nod, jump, lookData, notBool];
}
