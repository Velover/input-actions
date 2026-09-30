// Validator round 4: compile-time rules not covered by the other files (design spec sections 3, 4,
// 9 and 10), checked by plain tsc. Each rule stays on the one line after its directive.
import { InputActions, MouseController } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const R4 = InputActions.Schema({
	Menu: InputActions.Presets.UiNavigation({ Priority: 3000, Enabled: false }),
	Play: {
		Actions: {
			Lean: InputActions.Direction1D({ Stick: K.Thumbstick1Left, Keys: { Up: K.E, Down: K.Q } }),
			Jump: InputActions.Bool({ Keys: K.Space }, { TrackPrevious: true }),
		},
	},
});

export function ValidatorR4TypeRules() {
	const Input = InputActions.Create(R4);
	const player = undefined as unknown as Player;
	const { Navigate, Scroll, Accept } = Input.Menu.Actions;
	const { Lean, Jump } = Input.Play.Actions;

	// ---- what must compile, with the types it must have
	const navigate: Vector2 = Navigate.GetState();
	const scroll: number = Scroll.GetState();
	const lean: number = Lean.GetState();
	Scroll.Bindings.Mouse.Set(K.TrackpadPinch);
	Scroll.Bindings.KeyboardAndMouse.Capture("Down", () => {});
	Lean.Bindings.Keys.Set({ Up: K.Thumbstick2Up, Down: K.ButtonL2 });
	const accept: InputActions.BoolAction = Accept;
	const tracked: InputActions.BoolAction = Jump;
	MouseController.SetForceUnlockAction(Jump);
	MouseController.SetForceUnlockAction();

	// ---- things that must NOT compile
	// @ts-expect-error a misspelt preset option
	InputActions.Presets.UiNavigation({ Prority: 3000 });
	// @ts-expect-error the preset's actions are its own
	InputActions.Presets.UiNavigation({ Actions: {} });
	// @ts-expect-error a preset option of the wrong type
	InputActions.Presets.UiNavigation({ Sink: "yes" });
	// @ts-expect-error a preset not marked ServerAuthority has no LinkedToServer
	Input.Menu.LinkedToServer.Connect(() => {});
	// @ts-expect-error a preset not marked ServerAuthority is not on the server's handle
	InputActions.ForPlayer(R4, player).Menu;
	// @ts-expect-error Navigate is Direction2D: no Pressed
	Navigate.Pressed.Connect(() => {});
	// @ts-expect-error Scroll is Direction1D: no Left slot
	Scroll.Bindings.KeyboardAndMouse.Capture("Left", () => {});
	// @ts-expect-error Scroll is Direction1D: a stick doesn't drive it
	Scroll.Bindings.Mouse.Set(K.Thumbstick1);
	// @ts-expect-error the preset's bindings are key bindings, without Fire
	Accept.Bindings.Gamepad.Fire(true);
	// @ts-expect-error MouseController's force-unlock action is a Bool action
	MouseController.SetForceUnlockAction(Navigate);
	// @ts-expect-error Create's options are checked
	InputActions.Create(R4, { Folderr: new Instance("Folder") });
	// @ts-expect-error ProvideToPlayers' options are checked
	InputActions.ProvideToPlayers(R4, { PlayerFolder: "Inputs" });
	// @ts-expect-error a per-axis thumbstick key is not a Direction2D KeyCode
	InputActions.Direction2D({ Stick: K.Thumbstick1Up });
	// @ts-expect-error ImportBindings takes the saved JSON string
	Input.ImportBindings({ Version: 1 });
	// @ts-expect-error a context option of the wrong type
	InputActions.Schema({ Bad: { Priority: "high", Actions: {} } });
	// @ts-expect-error a context without Actions
	InputActions.Schema({ Bad: { Priority: 5 } });
	// @ts-expect-error a misspelt ServerAuthority: the context would silently be local
	InputActions.Schema({ Play: { ServerAuthorty: true, Actions: { Jump: InputActions.Bool({ Keys: K.Space }) } } });
	// @ts-expect-error a misspelt Priority
	InputActions.Schema({ Play: { Prority: 2000, Actions: { Jump: InputActions.Bool({ Keys: K.Space }) } } });
	// @ts-expect-error a misspelt Sink
	InputActions.Schema({ Play: { Snk: true, Actions: { Jump: InputActions.Bool({ Keys: K.Space }) } } });
	// @ts-expect-error a misspelt option beside correct ones
	InputActions.Schema({ Play: { Priority: 2000, Enable: false, Actions: {} } });
	// @ts-expect-error a misspelt preset option beside correct ones
	InputActions.Presets.UiNavigation({ Priority: 3000, Snk: true });

	return [navigate, scroll, lean, accept, tracked];
}
