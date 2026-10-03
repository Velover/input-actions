import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions, InputCatcher } from "@rbxts/input-actions";
import { expectedServerAuthority, isModeWarning, names } from "shared/fixtures/authority";
import { usesLegacyPlayerScripts } from "shared/fixtures/projects";
import { countSignal, createTestInput, frame, frames, newFolder, recordWarnings } from "./helpers";
import { clickProblem, emptyPoint, realInput, screenCenter, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;

/** Reads `read` for a few frames: true when it never became true */
function staysFalse(read: () => boolean, count = 6) {
	for (let index = 0; index < count; index++) {
		frame();
		if (read()) return false;
	}
	return true;
}

/**
 * Hunt round 2: the package with real keys, clicks and taps (VirtualInput), on local contexts, in
 * every project; and the claims the docs make about real input.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR2RealTests implements OnStart {
	onStart() {
		defineTests("hunter-r2-real", () => {
			// ---- rebinding an action at rest whose fired value a key-up overrode

			test("a rebind while Jump rests, after a key-up overrode a fired value, presses nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Fire(true);
				real.Press(K.Space);
				frames(3);
				real.Release(K.Space);
				// the key-up is the last write: Jump rests, though the package fired true last
				eventually(() => !jump.IsPressed(), "Jump at rest after the key-up");
				frames(2);
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				jump.Bindings.Gamepad.Set(K.ButtonB);
				frames(6);
				expectFalse(jump.IsPressed());
				expectEqual(
					`${pressed.count}/${released.count}`,
					"0/0",
					"Pressed/Released after the rebind",
				);
			});

			// ---- TrackPrevious through a rebind of a held key

			test("TrackPrevious: a rebind that releases a held key shows IsJustReleased once; the new key is IsJustPressed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				real.Press(K.C);
				eventually(() => crouch.IsPressed(), "C");
				frames(2);
				let justReleased = 0;
				crouch.Bindings.KeyboardAndMouse.Set(K.V);
				for (let index = 0; index < 8; index++) {
					frame();
					if (crouch.IsJustReleased()) justReleased++;
				}
				expectFalse(crouch.IsPressed(), "released by the rebind");
				expectEqual(justReleased, 1, "frames with IsJustReleased");
				real.Release(K.C);
				frames(2);
				let justPressed = 0;
				real.Press(K.V);
				for (let index = 0; index < 8; index++) {
					frame();
					if (crouch.IsJustPressed()) justPressed++;
				}
				expectEqual(justPressed, 1, "frames with IsJustPressed for V");
				real.Release(K.V);
				eventually(() => !crouch.IsPressed(), "released");
			});

			// ---- Capture into another binding of a held action

			// Capture applies the key as it goes down, a change to the action's keys while Space holds
			// it. Nothing may stick after. The Gamepad binding takes gamepad keys only (0.7.0): a
			// gamepad KeyCode as VirtualInput sends it (as a key, which IAS's gamepad binding doesn't
			// take, so the new key can't be seen holding Jump here)
			test("Capture into another binding of a held action: nothing sticks after both keys come up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				const captured = new Array<Enum.KeyCode>();
				jump.Bindings.Gamepad.Capture("KeyCode", (key) => captured.push(key ?? K.Unknown));
				real.Tap(K.G);
				expectEqual(captured.size(), 0, "G is the keyboard's: the Gamepad binding ignores it");
				real.Press(K.ButtonX);
				eventually(() => captured.size() === 1, "ButtonX captured");
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonX);
				frames(4);
				const afterCapture = `${jump.IsPressed()} P${pressed.count} R${released.count}`;
				real.Release(K.ButtonX);
				frames(4);
				const afterX = `${jump.IsPressed()} P${pressed.count} R${released.count}`;
				real.Release(K.Space);
				frames(4);
				const afterSpace = `${jump.IsPressed()} P${pressed.count} R${released.count}`;
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					`after the capture: ${afterCapture}; ButtonX up: ${afterX}; Space up: ${afterSpace}`,
				);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space presses Jump again");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released");
			});

			// docs/Advanced.md, Rebinding: a held action is released by a change to its keys, "whatever
			// holds it: a key, a button, a value fired from code"
			test("a rebind while an attached button is held releases the action; the button's release leaves it at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				const pressed = countSignal(jump.Pressed);
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "the button");
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				eventually(() => !jump.IsPressed(), "released by the rebind");
				real.MouseUp();
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"the button's release leaves it at rest",
				);
				real.MouseDown(screenCenter(button));
				eventually(() => pressed.count === 2, "the next press");
				real.MouseUp();
				eventually(() => !jump.IsPressed(), "released");
			});

			// ---- what the docs say about real input

			// docs/Advanced.md, Rebinding: "Ctrl+S on QuickSave and S on Move both fire on Ctrl then S"
			test("docs: Ctrl then S fires QuickSave and Move's S together", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { QuickSave, Move } = createTestInput().Gameplay.Actions;
				real.Press(K.LeftControl);
				frames(2);
				real.Press(K.S);
				eventually(() => QuickSave.IsPressed(), "QuickSave");
				eventually(() => Move.GetState() === new Vector2(0, -1), `Move down: ${Move.GetState()}`);
				real.Release(K.S);
				real.Release(K.LeftControl);
				eventually(() => !QuickSave.IsPressed() && Move.GetState() === Vector2.zero, "released");
			});

			// docs/Advanced.md, UI navigation preset: the legacy camera sinks Left and Right through CAS
			test("docs: the arrow keys reach Navigate, except Left and Right under the legacy player scripts", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				input.Ui.SetEnabled(true);
				const navigate = input.Ui.Actions.Navigate;
				real.Press(K.Left);
				frames(6);
				const left = navigate.GetState();
				real.Release(K.Left);
				eventually(() => navigate.GetState() === Vector2.zero, "at rest");
				real.Press(K.Down);
				eventually(() => navigate.GetState() === new Vector2(0, -1), "Down");
				real.Release(K.Down);
				if (usesLegacyPlayerScripts())
					expectEqual(left, Vector2.zero, "Left, sunk by the legacy camera");
				else expectEqual(left, new Vector2(-1, 0), "Left");
			});

			// docs/Advanced.md, IAS behaviours: a composite's keys "hold at most 1 while held". Since
			// 0.7.0 the preset's keyboard-and-mouse Scroll is the wheel (one binding per device):
			// PageUp/PageDown as a composite of that binding
			test("docs: Scroll's PageUp and PageDown (a composite) hold 1 and -1 while held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				input.Ui.SetEnabled(true);
				const scroll = input.Ui.Actions.Scroll;
				scroll.Bindings.KeyboardAndMouse.Set({ Up: K.PageUp, Down: K.PageDown });
				real.Press(K.PageUp);
				eventually(() => scroll.GetState() !== 0, "PageUp");
				frames(4);
				expectEqual(scroll.GetState(), 1, "held");
				real.Release(K.PageUp);
				eventually(() => scroll.GetState() === 0, "at rest");
				real.Press(K.PageDown);
				eventually(() => scroll.GetState() !== 0, "PageDown");
				frames(4);
				expectEqual(scroll.GetState(), -1, "held");
				real.Release(K.PageDown);
				eventually(() => scroll.GetState() === 0, "at rest");
			});

			// docs/Components/InputCatcher.md: "Blocks keyboard, mouse, gamepad and touch input to the game"
			test("docs: an active InputCatcher blocks a tap from a TouchPosition binding (touch)", () => {
				if (getProject() !== "touch") return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					HunterTouch: {
						Priority: 2500,
						Actions: { Anywhere: InputActions.Bool({ Touch: K.TouchPosition }) },
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder() });
				defer(() => input.Destroy());
				const anywhere = input.HunterTouch.Actions.Anywhere;
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				frames(2);
				real.MouseDown(emptyPoint());
				expectTrue(
					staysFalse(() => anywhere.IsPressed()),
					"the tap is caught",
				);
				real.MouseUp();
				frames(2);
				catcher.ReleaseInput();
				frames(2);
				real.MouseDown(emptyPoint());
				eventually(() => anywhere.IsPressed(), "through once released");
				real.MouseUp();
				eventually(() => !anywhere.IsPressed(), "released");
			});

			// docs/Components/InputCatcher.md and Advanced.md, On-screen buttons: "To keep a button from
			// acting, hide it, set Interactable = false on it, or remove its binding. Active = false is not
			// enough: it stops Activated, not the binding". The hunter measured, in every project, that
			// with Active = false a click or a tap no longer fires Activated but the button's UIButton
			// binding still presses the action, with or without a catcher (H2-F2: the docs said
			// Active = false was enough)
			test("docs: Interactable = false keeps a button from pressing its AttachButton action, with or without a catcher; Active = false doesn't", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const activated = countSignal(button.Activated);
				jump.AttachButton(button);
				const where = screenCenter(button);
				/** Clicks the button; whether that pressed Jump */
				const clickPresses = () => {
					real.MouseDown(where);
					const pressed = !staysFalse(() => jump.IsPressed());
					real.MouseUp();
					eventually(() => !jump.IsPressed(), "released");
					frames(2);
					return pressed;
				};
				button.Active = false;
				frames(2);
				const inactive = clickPresses();
				const inactiveActivated = activated.count;
				button.Active = true;
				button.Interactable = false;
				frames(2);
				const alone = clickPresses();
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				frames(2);
				const caught = clickPresses();
				expectEqual(
					`Active = false: pressed ${inactive}, Activated ${inactiveActivated}; ` +
						`Interactable = false: pressed ${alone}, under a catcher ${caught}`,
					"Active = false: pressed true, Activated 0; " +
						"Interactable = false: pressed false, under a catcher false",
				);
			});

			// docs/Components/InputCatcher.md: "To keep a button from acting, hide it"
			test("docs: a hidden button doesn't press its AttachButton action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				const where = screenCenter(button);
				button.Visible = false;
				frames(2);
				real.MouseDown(where);
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"a click where the hidden button is",
				);
				real.MouseUp();
			});

			// ---- the mode warning

			test("the UiNavigation preset marked ServerAuthority: true counts for the mode warning", () => {
				const warnings = recordWarnings();
				const schema = InputActions.Schema({
					HunterModeUi: InputActions.Presets.UiNavigation({
						ServerAuthority: true,
						Priority: 2600,
					}),
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: "InputsHunterMode",
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				frames(3);
				const mode = warnings.filter(
					(message) => isModeWarning(message) && names(message, "HunterModeUi"),
				);
				expectEqual(mode.size(), expectedServerAuthority() === false ? 1 : 0, mode.join(" | "));
			});
		});
	}
}
