import { InputActions } from "@rbxts/input-actions";

/** The schema most client tests create, in a scratch folder */
export const TEST_SCHEMA = InputActions.Schema({
	Gameplay: {
		Priority: 2000,
		Sink: true,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.Space,
				Gamepad: Enum.KeyCode.ButtonA,
			}),
			Fire: InputActions.Bool({
				KeyboardAndMouse: Enum.KeyCode.MouseLeftButton,
				Gamepad: { KeyCode: Enum.KeyCode.ButtonR2, PressedThreshold: 0.6 },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Gamepad: { KeyCode: Enum.KeyCode.Thumbstick1, ResponseCurve: 2 },
				Virtual: InputActions.Scriptable,
			}),
			Look: InputActions.Direction2D({
				KeyboardAndMouse: {
					KeyCode: Enum.KeyCode.MouseDelta,
					Scale: 0.02,
					Vector2Scale: new Vector2(1, -1),
				},
				Gamepad: Enum.KeyCode.Thumbstick2,
			}),
			Zoom: InputActions.Direction1D({
				KeyboardAndMouse: Enum.KeyCode.MouseWheel,
				Gamepad: { Up: Enum.KeyCode.DPadUp, Down: Enum.KeyCode.DPadDown },
			}),
			Fly: InputActions.Direction3D({
				KeyboardAndMouse: {
					Forward: Enum.KeyCode.W,
					Backward: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
					Up: Enum.KeyCode.Space,
					Down: Enum.KeyCode.LeftControl,
				},
			}),
			Aim: InputActions.ViewportPosition({ KeyboardAndMouse: Enum.KeyCode.MousePosition }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: Enum.KeyCode.S, PrimaryModifier: Enum.KeyCode.LeftControl },
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
			Steer: InputActions.Direction1D({ Gamepad: Enum.KeyCode.ButtonR2 }, { TrackPrevious: true }),
			Dash: InputActions.Bool(undefined, { DisplayName: "Dash" }),
		},
	},
	Menu: {
		Enabled: false,
		Actions: {
			Open: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.M }),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});

/** Names of the Server Authority fixture, shared by the server that provides it and the client */
export const SA_TEMPLATE_FOLDER = "InputActionsTestTemplates";
export const SA_REMOTE = "InputActionsTestServer";

/** A Server Authority context (with a template on the server) beside a local one */
export const SA_SCHEMA = InputActions.Schema({
	SaGameplay: {
		ServerAuthority: true,
		Priority: 1500,
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
				Virtual: InputActions.Scriptable,
			}),
		},
	},
	SaVehicle: {
		ServerAuthority: true,
		Priority: 1600,
		Sink: true,
		Actions: {
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S },
			}),
		},
	},
	SaLocal: {
		Actions: {
			Wave: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.G }),
		},
	},
});

/** Provided only when a client test asks, after its `Create`: the handles start on stand-ins */
export const SA_LATE_FOLDER_NAME = "InputsLate";
export const SA_LATE_SCHEMA = InputActions.Schema({
	LateGameplay: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Virtual: InputActions.Scriptable,
			}),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.C }, { TrackPrevious: true }),
		},
	},
	LateVehicle: {
		ServerAuthority: true,
		Actions: {
			Throttle: InputActions.Direction1D({
				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S },
			}),
		},
	},
});

/**
 * Builds the Server Authority template the way the Input Action Manager would: bindings named
 * `<Action><Device>`, a key that differs from the schema, and an action the schema lacks.
 */
export function BuildSaTemplate(parent: Instance): Folder {
	const folder = new Instance("Folder");
	folder.Name = SA_TEMPLATE_FOLDER;
	const context = new Instance("InputContext");
	context.Name = "SaGameplay";
	context.Priority = 1700;
	context.Sink = true;
	context.Parent = folder;

	const jump = new Instance("InputAction");
	jump.Name = "Jump";
	jump.Parent = context;
	const jumpKey = new Instance("InputBinding");
	jumpKey.Name = "JumpKeyboardAndMouse";
	jumpKey.KeyCode = Enum.KeyCode.F;
	jumpKey.Parent = jump;

	const emote = new Instance("InputAction");
	emote.Name = "Emote";
	emote.Parent = context;
	const emoteKey = new Instance("InputBinding");
	emoteKey.Name = "EmoteKeyboardAndMouse";
	emoteKey.KeyCode = Enum.KeyCode.H;
	emoteKey.Parent = emote;

	folder.Parent = parent;
	return folder;
}
