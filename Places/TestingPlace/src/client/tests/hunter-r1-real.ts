import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import {
	EMouseLockAction,
	InputActions,
	InputCatcher,
	MouseController,
	RawInputHandler,
} from "@rbxts/input-actions";
import { Players, UserInputService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { skip } from "shared/fixtures/skip";
import { countSignal, createTestInput, frame, frames, newFolder, recordSignal } from "./helpers";
import { clickProblem, emptyPoint, realInput, screenCenter, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;

/** Counts the frames, over `count`, in which `read` is true */
function framesWhere(count: number, read: () => boolean) {
	let seen = 0;
	for (let index = 0; index < count; index++) {
		frame();
		if (read()) seen++;
	}
	return seen;
}

/** Reads `read` for a few frames: true when it never became true */
function staysFalse(read: () => boolean, count = 6) {
	for (let index = 0; index < count; index++) {
		frame();
		if (read()) return false;
	}
	return true;
}

/**
 * Hunt round 1 (after the VirtualInput round): the package driven by real keys, clicks and taps
 * (UserInputService:CreateVirtualInput), in every project. Measured behaviour is asserted as it is;
 * what disagrees with the docs is named in the test.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR1RealTests implements OnStart {
	onStart() {
		defineTests("hunter-r1-real", () => {
			// ---- TrackPrevious with real keys

			test("TrackPrevious: a real press is IsJustPressed for exactly one frame, its release IsJustReleased for one", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				frames(2);
				real.Press(K.C);
				expectEqual(
					framesWhere(12, () => crouch.IsJustPressed()),
					1,
					"frames with IsJustPressed",
				);
				expectTrue(crouch.IsPressed());
				expectTrue(crouch.GetPrevious() === true, "the previous snapshot saw it held");
				expectFalse(crouch.HasChanged(), "nothing changed in the last frame");
				real.Release(K.C);
				expectEqual(
					framesWhere(12, () => crouch.IsJustReleased()),
					1,
					"frames with IsJustReleased",
				);
				expectFalse(crouch.IsPressed());
			});

			test("TrackPrevious: a real key down and up in one frame still shows IsJustPressed and IsJustReleased", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				const pressed = countSignal(crouch.Pressed);
				frames(2);
				real.Device.SendKey(true, K.C, false);
				real.Device.SendKey(false, K.C, false);
				let justPressed = 0;
				let justReleased = 0;
				for (let index = 0; index < 8; index++) {
					frame();
					if (crouch.IsJustPressed()) justPressed++;
					if (crouch.IsJustReleased()) justReleased++;
				}
				expectEqual(pressed.count, 1, "IAS saw the press");
				expectEqual(justPressed, 1, "IsJustPressed frames");
				expectEqual(justReleased, 1, "IsJustReleased frames");
				expectFalse(crouch.IsPressed());
			});

			// ---- contexts and actions with a key held

			test("a context disabled while a real key is held stays released after it is enabled again, the key still down", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "the press");
				const release = input.Gameplay.Request(false);
				eventually(() => !jump.IsPressed(), "released by the request");
				frames(2);
				release();
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"not pressed again while Space is still down",
				);
				real.Release(K.Space);
				frames(3);
				expectEqual(pressed.count, 1);
				expectEqual(released.count, 1);
				real.Tap(K.Space);
				eventually(() => pressed.count === 2, "the next press counts");
			});

			test("rebinding a held key on a local context releases the action at once, and nothing stays stuck", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const { Jump, Move } = input.Gameplay.Actions;
				real.Press(K.Space);
				eventually(() => Jump.IsPressed(), "Space");
				Jump.Bindings.KeyboardAndMouse.Set(K.F);
				eventually(() => !Jump.IsPressed(), "released by the rebind");
				real.Release(K.Space);
				expectTrue(staysFalse(() => Jump.IsPressed()));

				real.Press(K.W);
				eventually(() => Move.GetState() === new Vector2(0, 1), "W");
				Move.Bindings.KeyboardAndMouse.Set({ Up: K.T });
				eventually(() => Move.GetState() === Vector2.zero, "released by the rebind");
				real.Release(K.W);
				frames(3);
				expectEqual(Move.GetState(), Vector2.zero);
			});

			test("Set with the binding's own key while it is held changes nothing: the action stays pressed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				jump.Bindings.KeyboardAndMouse.Set(K.Space);
				frames(4);
				expectTrue(jump.IsPressed(), "still pressed: the binding is the same");
				expectEqual(released.count, 0, "Released");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released with the key");
			});

			test("ImportBindings of the save already applied changes nothing while its rebound key is held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const save = '{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F"}}}';
				expectEqual(input.ImportBindings(save).Applied.size(), 1);
				const released = countSignal(jump.Released);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), "F");
				const changes = recordSignal(input.BindingsChanged);
				expectEqual(input.ImportBindings(save).Applied.size(), 1);
				frames(4);
				expectEqual(changes.size(), 0, "BindingsChanged: nothing changed");
				expectTrue(jump.IsPressed(), "still pressed: the binding is the same");
				expectEqual(released.count, 0, "Released");
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "released with the key");
			});

			test("ResetOnFocusLoss: false: a key held when a TextBox takes focus keeps the action pressed until it comes up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput(newFolder(), { ResetOnFocusLoss: false }).Gameplay.Actions
					.Jump;
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space");
				const box = new Instance("TextBox");
				box.Size = UDim2.fromOffset(200, 50);
				box.Text = "";
				box.Parent = testGui("HunterNoResetBox");
				defer(() => box.ReleaseFocus());
				box.CaptureFocus();
				frames(4);
				expectTrue(jump.IsPressed(), "no reset: still pressed");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "the key-up releases it");
			});

			test("UiNavigation with real keys; while it is on, it sinks the wheel from Gameplay's Zoom", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				input.Ui.SetEnabled(true);
				const { Navigate, Accept, Cancel, NextPage, PreviousPage, Scroll } = input.Ui.Actions;
				real.Press(K.Up);
				eventually(() => Navigate.GetState() === new Vector2(0, 1), "Up");
				real.Release(K.Up);
				eventually(() => Navigate.GetState() === Vector2.zero, "at rest");
				const bools: Array<[Enum.KeyCode, InputActions.BoolAction]> = [
					[K.Return, Accept],
					[K.B, Cancel],
					[K.E, NextPage],
					[K.Q, PreviousPage],
				];
				for (const [key, action] of bools) {
					real.Press(key);
					eventually(() => action.IsPressed(), key.Name);
					real.Release(key);
					eventually(() => !action.IsPressed(), `${key.Name} released`);
				}
				real.Press(K.PageUp);
				eventually(() => Scroll.GetState() > 0, "PageUp");
				real.Release(K.PageUp);
				real.Press(K.PageDown);
				eventually(() => Scroll.GetState() < 0, "PageDown");
				real.Release(K.PageDown);
				eventually(() => Scroll.GetState() === 0, "at rest");
				if (getProject() === "touch") return;
				const zoomed = countSignal(input.Gameplay.Actions.Zoom.StateChanged);
				const scrolled = countSignal(Scroll.StateChanged);
				real.Wheel(1);
				eventually(() => scrolled.count > 0, "Scroll takes the wheel");
				frames(3);
				expectEqual(zoomed.count, 0, "sunk from Zoom");
			});

			// ---- chords and rebinding

			test("Clear(PrimaryModifier) turns Ctrl+S into plain S; a new modifier then replaces Ctrl", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const save = createTestInput().Gameplay.Actions.QuickSave;
				const keys = save.Bindings.KeyboardAndMouse;
				keys.Clear("PrimaryModifier");
				real.Press(K.S);
				eventually(() => save.IsPressed(), "plain S");
				real.Release(K.S);
				eventually(() => !save.IsPressed(), "released");

				keys.Set({ KeyCode: K.S, PrimaryModifier: K.RightControl });
				real.Press(K.LeftControl);
				frames(2);
				real.Press(K.S);
				expectTrue(
					staysFalse(() => save.IsPressed()),
					"LeftControl+S no longer",
				);
				real.Release(K.S);
				real.Release(K.LeftControl);
				frames(2);
				real.Press(K.RightControl);
				frames(2);
				real.Press(K.S);
				eventually(() => save.IsPressed(), "RightControl+S");
				real.Release(K.S);
				real.Release(K.RightControl);
				eventually(() => !save.IsPressed(), "released");
			});

			test("an imported rebind answers to the new key; ResetBindings brings the old one back", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F"}}}',
				);
				expectEqual(result.Applied.size(), 1);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), "F");
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "released");
				input.ResetBindings();
				real.Press(K.F);
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"F after the reset",
				);
				real.Release(K.F);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "Space after the reset");
				real.Release(K.Space);
			});

			test("two root handles on one folder both hear a real press; destroying one leaves the other's action held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => second.Destroy());
				const firstPressed = countSignal(first.Gameplay.Actions.Jump.Pressed);
				const secondPressed = countSignal(second.Gameplay.Actions.Jump.Pressed);
				real.Press(K.Space);
				eventually(() => firstPressed.count === 1 && secondPressed.count === 1, "both handles");
				second.Destroy();
				frames(3);
				expectTrue(first.Gameplay.Actions.Jump.IsPressed(), "still held for the first handle");
				real.Release(K.Space);
				eventually(() => !first.Gameplay.Actions.Jump.IsPressed(), "released");
				expectEqual(firstPressed.count, 1);
			});

			// ---- Capture with real input

			test("Capture: a click on a GuiButton is ignored (game-processed); a click on the world is taken", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				real.Click(screenCenter(button));
				frames(2);
				expectEqual(captured.size(), 0, "the click on the button");
				real.Click(emptyPoint());
				eventually(() => captured.size() === 1, "the click on the world");
				const expected = getProject() === "touch" ? K.TouchPosition : K.MouseLeftButton;
				expectEqual(captured[0], expected);
				expectEqual(keys.Instance.KeyCode, expected);
			});

			test("Capture ignores keys typed into a focused TextBox, then takes the next key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const keys = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const box = new Instance("TextBox");
				box.Size = UDim2.fromOffset(200, 50);
				box.Text = "";
				box.Parent = testGui("HunterCaptureBox");
				defer(() => box.ReleaseFocus());
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				box.CaptureFocus();
				frames(2);
				real.Tap(K.G);
				expectEqual(captured.size(), 0, "typed into the TextBox");
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "focus released");
				frames(3);
				real.Tap(K.H);
				eventually(() => captured.size() === 1, "the next key");
				expectEqual(captured[0], K.H);
			});

			// H1-F4: MouseWheel is legal for a Direction1D KeyCode, but it raises InputChanged only, so
			// Capture never sees it (docs/Advanced.md, Rebinding, now says so)
			test("Capture on a Direction1D KeyCode slot never takes the mouse wheel (measured)", () => {
				if (getProject() === "touch") return skip("no wheel on a simulated phone");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const zoomKeys = createTestInput().Gameplay.Actions.Zoom.Bindings.Mouse;
				zoomKeys.Clear();
				const captured = new Array<Enum.KeyCode>();
				const stop = zoomKeys.Capture("KeyCode", (key) => captured.push(key));
				defer(stop);
				real.Wheel(1);
				frames(4);
				expectEqual(captured.size(), 0);
				expectEqual(zoomKeys.Instance.KeyCode, K.None);
			});

			// ---- AttachButton with real clicks and taps

			test("AttachButton: a press released off the button releases the action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const activated = countSignal(button.Activated);
				jump.AttachButton(button);
				let down = true;
				real.Device.SendMouseButton(screenCenter(button), Enum.UserInputType.MouseButton1, true);
				defer(() => {
					if (down)
						pcall(() =>
							real.Device.SendMouseButton(emptyPoint(), Enum.UserInputType.MouseButton1, false),
						);
				});
				eventually(() => jump.IsPressed(), "pressed on the button");
				real.Device.SendMouseButton(emptyPoint(), Enum.UserInputType.MouseButton1, false);
				down = false;
				eventually(() => !jump.IsPressed(), "released off the button");
				expectEqual(activated.count, 0, "no Activated off the button");
			});

			test("AttachButton: removing the held button's binding releases the action; the other button still works", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const gui = testGui();
				const left = testButton(gui, "Left", 0.3);
				const right = testButton(gui, "Right", 0.6);
				const problem = clickProblem(left) ?? clickProblem(right);
				if (problem !== undefined) return skip(problem);
				const released = countSignal(jump.Released);
				const detachLeft = jump.AttachButton(left);
				jump.AttachButton(right);
				real.MouseDown(screenCenter(left));
				eventually(() => jump.IsPressed(), "the left button");
				detachLeft();
				eventually(() => !jump.IsPressed(), "released when its binding goes");
				real.MouseUp();
				expectTrue(staysFalse(() => jump.IsPressed()));
				real.MouseDown(screenCenter(right));
				eventually(() => jump.IsPressed(), "the right button");
				real.MouseUp();
				eventually(() => !jump.IsPressed(), "released");
				expectTrue(released.count >= 2, `Released ${released.count}`);
			});

			test("AttachButton: the button destroyed under the finger releases the action, and the release of the press changes nothing", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "pressed");
				button.Destroy();
				eventually(() => !jump.IsPressed(), "released with the button");
				real.MouseUp();
				expectTrue(staysFalse(() => jump.IsPressed()));
				expectEqual(
					jump.Instance.GetChildren()
						.filter((child) => child.Name === "JumpUIButton1")
						.size(),
					0,
				);
			});

			test("AttachButton: a second root handle destroyed while its button is held releases the shared action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => second.Destroy());
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				second.Gameplay.Actions.Jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(
					() => first.Gameplay.Actions.Jump.IsPressed(),
					"pressed through the second handle's button",
				);
				second.Destroy();
				eventually(
					() => !first.Gameplay.Actions.Jump.IsPressed(),
					"released with the second handle",
				);
				real.MouseUp();
				expectTrue(staysFalse(() => first.Gameplay.Actions.Jump.IsPressed()));
			});

			test("AttachButton: a context disabled while the button is held stays released after it comes back", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "pressed");
				const release = input.Gameplay.Request(false);
				eventually(() => !jump.IsPressed(), "released by the request");
				release();
				frames(3);
				real.MouseUp();
				expectTrue(
					staysFalse(() => jump.IsPressed()),
					"not stuck after the press ends",
				);
			});

			// H1-F3: a GuiButton gets the click before ContextActionService, so an AttachButton binding
			// still presses its action (docs/Components/InputCatcher.md now says so)
			test("InputCatcher does not block an action's AttachButton binding (measured)", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { Jump, Fire } = createTestInput().Gameplay.Actions;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				Jump.AttachButton(button);
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				frames(2);
				real.MouseDown(screenCenter(button));
				eventually(() => Jump.IsPressed(), "the button's binding presses Jump through the catcher");
				real.MouseUp();
				eventually(() => !Jump.IsPressed(), "released");
				if (getProject() !== "touch") {
					real.MouseDown(emptyPoint());
					expectTrue(
						staysFalse(() => Fire.IsPressed()),
						"MouseLeftButton is caught",
					);
					real.MouseUp();
				}
			});

			// ---- sinking between the package's contexts

			test("a disabled action in a sinking context doesn't sink its key; a raised Priority takes the key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					HunterHigh: {
						Priority: 3500,
						Sink: true,
						Actions: { Use: InputActions.Bool({ Key: K.G }) },
					},
					HunterLow: {
						Priority: 3400,
						Sink: true,
						Actions: { Use: InputActions.Bool({ Key: K.G }) },
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder() });
				defer(() => input.Destroy());
				const high = input.HunterHigh.Actions.Use;
				const low = input.HunterLow.Actions.Use;
				high.SetEnabled(false);
				real.Press(K.G);
				eventually(() => low.IsPressed(), "the key reaches the context below");
				real.Release(K.G);
				eventually(() => !low.IsPressed(), "released");
				high.SetEnabled(true);
				input.HunterLow.Instance.Priority = 3600;
				frames(2);
				real.Press(K.G);
				eventually(() => low.IsPressed(), "the raised context takes it");
				expectTrue(
					staysFalse(() => high.IsPressed()),
					"and sinks it",
				);
				real.Release(K.G);
			});

			// ---- MouseController and RawInputHandler with real input

			test("MouseController.SetForceUnlockAction unlocks while a real key holds the action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				MouseController.Initialize();
				const lock = new MouseController.MouseLockAction(EMouseLockAction.LockMouseCenter, 1e6);
				lock.SetActive(true);
				defer(() => lock.SetActive(false));
				MouseController.SetForceUnlockAction(jump);
				defer(() => MouseController.SetForceUnlockAction());
				for (
					let index = 0;
					index < 30 && UserInputService.MouseBehavior !== Enum.MouseBehavior.LockCenter;
					index++
				)
					frame();
				if (UserInputService.MouseBehavior !== Enum.MouseBehavior.LockCenter)
					return skip("MouseBehavior never read LockCenter in this window");
				real.Press(K.Space);
				eventually(
					() => UserInputService.MouseBehavior === Enum.MouseBehavior.Default,
					"unlocked while held",
				);
				real.Release(K.Space);
				eventually(
					() => UserInputService.MouseBehavior === Enum.MouseBehavior.LockCenter,
					"locked again",
				);
			});

			test("RawInputHandler: a real W moves forward; ControlSetEnabled(false) stops it while W is held", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				RawInputHandler.Initialize();
				defer(() => RawInputHandler.ControlSetEnabled(true));
				real.Press(K.W);
				eventually(() => RawInputHandler.GetMoveVector().Z < 0, "forward");
				RawInputHandler.ControlSetEnabled(false);
				eventually(() => RawInputHandler.GetMoveVector().Magnitude === 0, "stopped");
				real.Release(K.W);
				RawInputHandler.ControlSetEnabled(true);
				frames(3);
				expectEqual(RawInputHandler.GetMoveVector().Magnitude, 0);
				real.Press(K.W);
				eventually(() => RawInputHandler.GetMoveVector().Z < 0, "forward again");
				real.Release(K.W);
				eventually(() => RawInputHandler.GetMoveVector().Magnitude === 0, "at rest");
			});

			// ---- the Server Authority stand-in, played on the client

			test("the stand-in swap with a real key held: events stay paired and nothing sticks", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = new Instance("Folder");
				folder.Name = "HunterR1Copy";
				const context = new Instance("InputContext");
				context.Name = "HunterSwap";
				const action = new Instance("InputAction");
				action.Name = "Jump";
				action.Parent = context;
				defer(() => folder.Destroy());
				const schema = InputActions.Schema({
					HunterSwap: { ServerAuthority: true, Actions: { Jump: InputActions.Bool({ Key: K.J }) } },
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folder.Name,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const jump = input.HunterSwap.Actions.Jump;
				const events = new Array<string>();
				jump.Pressed.Connect(() => events.push("P"));
				jump.Released.Connect(() => events.push("R"));
				real.Press(K.J);
				eventually(() => jump.IsPressed(), "pressed on the stand-in");
				context.Parent = folder;
				folder.Parent = Players.LocalPlayer;
				eventually(() => input.HunterSwap.IsLinkedToServer(), "linked");
				real.Release(K.J);
				frames(4);
				expectFalse(jump.IsPressed());
				real.Tap(K.J);
				frames(3);
				expectFalse(jump.IsPressed());
				const sequence = events.join("");
				expectTrue(sequence.find("PP", 1, true)[0] === undefined, sequence);
				expectTrue(sequence.find("RR", 1, true)[0] === undefined, sequence);
				expectEqual(sequence.sub(-1), "R", sequence);
			});
		});
	}
}
