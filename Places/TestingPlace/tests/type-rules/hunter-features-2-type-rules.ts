// Hunter, features loop round 2: compile-time findings on AnyNameBindingSpec (computed binding
// names), and the Guide's recipes as written (they compile). Checked by plain tsc.
//
// The values below are ones no binding of any name can be (Schema refuses each under every name:
// the `hunter-features-2` section's "HF2-2, HF2-3 evidence" test). Each is refused under a computed
// name too, and its `// @ts-expect-error` keeps it so.
import { InputActions } from "@rbxts/input-actions";
import { GuiService, Players, ReplicatedStorage, RunService, UserInputService } from "@rbxts/services";

const K = Enum.KeyCode;
declare const computedName: string;

// HF2-2 (fixed): a binding under a computed name was checked against the action type's shapes with
// any device's keys (`IBindingShapeMap[T]`, `IAnyDeviceKeys`), so one binding could mix devices, and
// a namespace could take a reserved extra name: no name accepts either (one device's keys per
// binding; a namespace's extras can't be named after a binding handle's member or a binding
// property). Now `BindingShape<T>` (a union over the devices) and a namespace per device, with the
// reserved extra names refused. Design spec §3: "a key or a shape no binding of the action type can
// take is refused".
export const HF2_2 = [
	// @ts-expect-error a gamepad key with a keyboard modifier
	InputActions.Bool({ [computedName]: { KeyCode: K.ButtonA, PrimaryModifier: K.LeftControl } }),
	// @ts-expect-error a composite with a keyboard key and a gamepad key
	InputActions.Direction1D({ [computedName]: { Up: K.W, Down: K.ButtonA } }),
	// @ts-expect-error a namespace whose Main is the keyboard's and whose extra is the gamepad's
	InputActions.Bool({ [computedName]: { Main: K.E, Alt: K.ButtonA } }),
	// @ts-expect-error a namespace with an extra named after a binding handle's member
	InputActions.Bool({ [computedName]: { Main: K.E, Set: K.F } }),
	// @ts-expect-error and one named after a binding's property
	InputActions.Bool({ [computedName]: { Main: K.E, KeyCode: K.F } }),
];
// what a computed name may hold still compiles: one device's keys in a binding or a namespace
export const HF2_2_OK = [
	InputActions.Bool({ [computedName]: { KeyCode: K.ButtonA, PrimaryModifier: K.ButtonL1 } }),
	InputActions.Direction1D({ [computedName]: { Up: K.W, Down: K.S } }),
	InputActions.Direction1D({ [computedName]: { Up: K.DPadUp, Down: K.DPadDown } }),
	InputActions.Bool({ [computedName]: { Main: K.ButtonA, Alt: K.ButtonB, Spare: {} } }),
	InputActions.Bool({ [computedName]: { Main: {}, Alt: K.E } }),
	InputActions.Direction2D({ [computedName]: { Main: K.Thumbstick1, Pad: { Up: K.DPadUp } } }),
	InputActions.Bool({ [computedName]: { Main: K.TouchPosition } }),
];

// HF2-3 (fixed): the escape (`IAnyObject extends B[K] ? unknown`) took more than a value typed
// `any`: any value whose type has only optional properties (a `Partial`, a `BindingPart`, another
// binding's `Get()`) skipped the check, keys the action type never takes included. Under a device's
// name the same values are refused (HF2_3_NAMED). Now `IScriptable extends B[K]`: the builders'
// constraint, `any` and Scriptable (`unknown extends B[K]` took the type rules to 245 s). Design
// spec §3: "A value typed `any` keeps compiling, for `Schema` to check".
declare const boolPad: InputActions.BindingHandle<Enum.InputActionType.Bool, "Gamepad">;
export const HF2_3 = [
	// @ts-expect-error MouseDelta, which no Bool binding takes
	InputActions.Bool({ [computedName]: {} as { KeyCode?: Enum.KeyCode.MouseDelta } }),
	// @ts-expect-error Escape, reserved, in a composite
	InputActions.Direction2D({ [computedName]: {} as { Up?: Enum.KeyCode.Escape } }),
	// @ts-expect-error a property no binding has
	InputActions.Bool({ [computedName]: {} as { Typo?: number } }),
	// @ts-expect-error a Bool binding's Get() given to a Direction2D action
	InputActions.Direction2D({ [computedName]: boolPad.Get() }),
];
// @ts-expect-error under a device's name the same value is refused: MouseDelta in a Bool binding
export const HF2_3_NAMED = InputActions.Bool({ Gamepad: {} as { KeyCode?: Enum.KeyCode.MouseDelta } });
// a value typed any keeps compiling, for Schema to check; so do Scriptable and a binding with
// optional properties beside its key
declare const unknownBinding: unknown;
declare const anyBinding: any;
export const HF2_3_OK = [
	InputActions.Direction2D({ [computedName]: anyBinding }),
	InputActions.Bool({ [computedName]: InputActions.Scriptable }),
	InputActions.Bool({ [computedName]: { KeyCode: K.ButtonA, PressedThreshold: 0.6 } }),
	InputActions.Direction2D({ [computedName]: { KeyCode: K.Thumbstick2, ResponseCurve: 2 } }),
];
// @ts-expect-error a value typed unknown fails the builders' constraint (as before the fix): cast it
export const HF2_3_UNKNOWN = InputActions.Bool({ [computedName]: unknownBinding });

// ---- the Guide's recipes, as written (docs/Guide.md, 1 to 9): they compile

export const InputSchema = InputActions.Schema({
	Gameplay: {
		Priority: 2000, // above the PlayerModule's contexts
		Sink: true, // lower contexts don't get the keys bound here
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} }, // Alt: an Alternate key the player fills
				Gamepad: { Main: K.ButtonA, Alt: {} },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
				Virtual: InputActions.Scriptable, // an on-screen stick, driven from code
			}),
			Interact: InputActions.Bool({ KeyboardAndMouse: K.E, Gamepad: K.ButtonX }),
			Shoot: InputActions.Bool({ KeyboardAndMouse: K.MouseLeftButton, Gamepad: K.ButtonR2 }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl }, // Ctrl+S
			}),
		},
	},
	Menu: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
});

export const Input = InputActions.Create(InputSchema); // waits for game.Loaded

// recipe 2
{
	const { Jump, Move, Interact, Shoot, Crouch } = Input.Gameplay.Actions;
	Jump.Pressed.Connect(() => print("jump"));
	Move.StateChanged.Connect((direction) => print(direction)); // Vector2
	RunService.RenderStepped.Connect(() => {
		const direction = Move.GetState(); // Vector2: X right, Y forward
		if (Shoot.IsPressed()) print(`shooting while moving ${direction}`);
		if (Crouch.IsJustPressed()) print("crouched this frame"); // needs TrackPrevious: true
	});
	Jump.OnDoubleTap(() => print("double jump"));
	Interact.OnTap(() => print("look at it"));
	Interact.OnHold(() => print("door opened"), {
		Duration: 0.8,
		Progress: (fraction) => print(fraction), // each frame while held, 0 to 1: fill a bar
		Cancelled: () => print("let go too soon"),
	});
	const stopCharging = Shoot.OnLongPress((heldFor) => print(`charged shot: ${heldFor} s`), { Duration: 0.5 });
	stopCharging();
	Move.Bindings.Virtual.Fire(new Vector2(0, 1));
	Move.Bindings.Virtual.Fire(Vector2.zero);
}

// recipe 3
type AnyBinding = InputActions.BindingHandle<Enum.InputActionType, InputActions.Device>;
const COLUMNS = ["KeyboardAndMouse", "Gamepad"] as const;
const CANCEL = [Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB];
const { Jump, Interact, Shoot, QuickSave } = Input.Gameplay.Actions;
const ROWS: InputActions.CaptureAction[] = [Jump, Interact, Shoot, QuickSave];
function Text(binding: AnyBinding | undefined) {
	const text = binding?.Describe() ?? ""; // "Space", "Ctrl + S", "RT"; "" when unbound
	return text === "" ? "-" : text;
}
function Render(device: InputActions.Device) {
	if (device === "Touch") {
		print("Plug in a keyboard or a gamepad to rebind"); // touch has no keys to capture
		return;
	}
	for (const action of ROWS) {
		const cells = COLUMNS.map((column) => {
			const main = action.Bindings[column];
			const text = `${Text(main)} / ${Text(main.Extras().Alt)}`;
			return column === device ? `[${text}]` : text;
		});
		print(`${action.Name}: ${cells.join(" | ")}`);
	}
}
InputActions.PreferredDeviceChanged.Connect(Render);
Input.BindingsChanged.Connect(() => Render(InputActions.PreferredDevice()));
Render(InputActions.PreferredDevice());
function BeginCapture(): () => void {
	const selected = GuiService.SelectedObject;
	GuiService.SelectedObject = undefined;
	const resumeMenu = Input.Menu.Request(false);
	return () => {
		resumeMenu();
		GuiService.SelectedObject = selected;
	};
}
function FreeKey(binding: AnyBinding) {
	for (const conflict of Input.Gameplay.FindConflicts(binding)) {
		warn(`${conflict.Key.Name} was also ${conflict.Path}`);
		conflict.Binding.Clear(conflict.Slot);
	}
}
export function RebindAction(action: InputActions.CaptureAction): () => void {
	const finish = BeginCapture();
	const stop = action.CaptureChord(
		(chord, device) => {
			finish();
			if (chord !== undefined && device !== undefined) FreeKey(action.Bindings[device]);
		},
		{ Cancel: CANCEL, Timeout: 5 },
	);
	return () => {
		stop();
		finish();
	};
}
export function RebindCell(
	action: InputActions.CaptureAction,
	device: InputActions.CapturableDevice,
	alternate: boolean,
): () => void {
	const binding = alternate ? action.Bindings[device].Extras().Alt : action.Bindings[device];
	if (binding === undefined) return () => {};
	const finish = BeginCapture();
	const stop = binding.CaptureChord(
		(chord) => {
			finish();
			if (chord !== undefined) FreeKey(binding);
		},
		{ Cancel: CANCEL, Timeout: 5 },
	);
	return () => {
		stop();
		finish();
	};
}

// recipe 5
{
	const gui = new Instance("ScreenGui");
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	const button = new Instance("TextButton");
	const detach = Input.Gameplay.Actions.Jump.AttachButton(button);
	detach();
	const show = (device: InputActions.Device) => (button.Visible = device === "Touch");
	show(InputActions.PreferredDevice());
	InputActions.PreferredDeviceChanged.Connect(show);
}

// recipe 6
{
	const { Interact } = Input.Gameplay.Actions;
	const hint = new Instance("TextLabel");
	const refresh = () => (hint.Text = `Hold ${Interact.Describe()}`);
	refresh();
	InputActions.PreferredDeviceChanged.Connect(refresh);
	Input.BindingsChanged.Connect(refresh);
	const label = new Instance("InputActionLabel");
	const detach = Interact.AttachLabel(label);
	detach();
	const icon = new Instance("ImageLabel");
	const key = Interact.Bindings.Gamepad.Get().KeyCode;
	if (key !== undefined) icon.Image = UserInputService.GetImageForKeyCode(key);
}

// recipe 8
export function RecordQuickSave(): () => void {
	const keys = QuickSave.Bindings.KeyboardAndMouse;
	return keys.CaptureChord(
		(chord) => print(chord === undefined ? "unchanged" : `Quick save is now ${keys.Describe()}`),
		{ Cancel: [Enum.KeyCode.Backspace], Timeout: 5 },
	);
}
export function DropModifier() {
	QuickSave.Bindings.KeyboardAndMouse.Clear("PrimaryModifier");
}

// recipe 9
export function OpenMenu() {
	const closeMenu = Input.Menu.Request(true);
	const resumeGameplay = Input.Gameplay.Request(false);
	Input.Menu.Actions.Cancel.Pressed.Once(() => {
		closeMenu();
		resumeGameplay();
	});
}

// recipe 7
export const CharacterSchema = InputActions.Schema({
	Character: {
		ServerAuthority: true,
		Priority: 2000,
		Sink: true,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
			}),
			Dash: InputActions.Bool({ KeyboardAndMouse: K.Q, Gamepad: K.ButtonX }),
		},
	},
	Hud: { Actions: { Map: InputActions.Bool({ KeyboardAndMouse: K.M }) } },
});
{
	InputActions.ProvideToPlayers(CharacterSchema);
	const inputs = new Map<Player, InputActions.ServerHandle<typeof CharacterSchema.Contexts>>();
	function Watch(player: Player) {
		const input = InputActions.ForPlayer(CharacterSchema, player);
		inputs.set(player, input);
		input.Character.Actions.Dash.Pressed.Connect(() => print(`${player.Name} dashed`));
	}
	Players.PlayerAdded.Connect(Watch);
	RunService.BindToSimulation(() => {
		for (const [player, input] of inputs) {
			const move = input.Character.Actions.Move.GetState();
			if (move.Magnitude > 0) print(`${player.Name} moves ${move}`);
		}
	});
	const CInput = InputActions.Create(CharacterSchema);
	CInput.Character.WhenLinkedToServer(() => print("the server receives Character's state now"));
	CInput.Character.Actions.Dash.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.E);
}

// recipe 4
{
	const remotes = ReplicatedStorage.WaitForChild("Keybinds");
	const loadRemote = remotes.WaitForChild("Load") as RemoteFunction;
	const save = loadRemote.InvokeServer();
	if (typeIs(save, "string")) {
		const result = Input.ImportBindings(save);
		for (const skipped of result.Skipped) warn(`${skipped.Path} not loaded: ${skipped.Reason}`);
	}
	const saves = new Map<Player, string>();
	const json = "";
	saves.set(Players.LocalPlayer, InputActions.SanitizeBindings(InputSchema, json));
}
