import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectTrue,
	fail,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import {
	EMouseLockAction,
	InputActions,
	InputCatcher,
	MouseController,
	RawInputHandler,
} from "@rbxts/input-actions";
import { GuiService, RunService, UserInputService, Workspace } from "@rbxts/services";
import {
	countSignal,
	createTestInput,
	frames,
	nearlyEqual,
	newFolder,
	recordSignal,
} from "./helpers";
import {
	clickProblem,
	emptyPoint,
	guiInset,
	pointerReport,
	RealInput,
	realInput,
	screenCenter,
	testButton,
	testGui,
} from "./virtual";

const K = Enum.KeyCode;

/**
 * Two actions on one key, one of them a chord; and one action that a test gives a second key (an
 * action has one binding per device: the second is a binding the test makes by hand)
 */
const KEYS_SCHEMA = InputActions.Schema({
	RealKeys: {
		Priority: 2500,
		Actions: {
			Copy: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.C, PrimaryModifier: K.LeftControl },
			}),
			Plain: InputActions.Bool({ KeyboardAndMouse: K.C }),
			Use: InputActions.Bool({ KeyboardAndMouse: K.R }),
		},
	},
});

/** A sinking context above one that binds the same key and another */
const SINK_SCHEMA = InputActions.Schema({
	SinkHigh: {
		Priority: 3500,
		Sink: true,
		Actions: { Use: InputActions.Bool({ KeyboardAndMouse: K.G }) },
	},
	SinkLow: {
		Priority: 3400,
		Actions: {
			Use: InputActions.Bool({ KeyboardAndMouse: K.G }),
			Other: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

/** The wheel unclamped, beside the UiNavigation preset's Scroll */
const WHEEL_SCHEMA = InputActions.Schema({
	Wheel: {
		Priority: 2500,
		Actions: {
			Raw: InputActions.Direction1D({
				KeyboardAndMouse: { KeyCode: K.MouseWheel, ClampMagnitudeToOne: false },
			}),
		},
	},
	Ui: InputActions.Presets.UiNavigation({ Priority: 2400 }),
});

function isTouch() {
	return getProject() === "touch";
}

const CURSOR_UNLOCKED =
	"the cursor never locked in this window, and SendMouseDelta needs it locked";

const MOUSE_AS_TOUCH =
	"Studio simulates a phone: mouse events arrive as touch (the touch section taps instead)";

/** A TextBox in the middle of the screen, focus released after the test */
function newTextBox() {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Position = UDim2.fromScale(0.3, 0.6);
	box.Text = "";
	box.Parent = testGui("InputActionsRealTextBox");
	defer(() => box.ReleaseFocus());
	return box;
}

/**
 * Locks the cursor at the centre with MouseController until the test ends, and moves the mouse by
 * `delta`. The lock lands a frame after `MouseBehavior` reads `LockCenter`, and `SendMouseDelta`
 * throws until it has; false when it never does.
 */
function moveLockedMouse(real: RealInput, delta: Vector2): boolean {
	MouseController.Initialize();
	const lock = new MouseController.MouseLockAction(EMouseLockAction.LockMouseCenter, 1e6);
	lock.SetActive(true);
	defer(() => lock.SetActive(false));
	for (let index = 0; index < 30; index++) {
		frames(1);
		if (UserInputService.MouseBehavior !== Enum.MouseBehavior.LockCenter) continue;
		const [ok, problem] = pcall(() => real.MouseDelta(delta));
		if (ok) return true;
		if (tostring(problem).find("not locked", 1, true)[0] === undefined) error(problem, 0);
	}
	return false;
}

/** The first value other than `rest` in what a signal passed */
function firstMoved<T extends defined>(values: readonly T[], rest: T): T | undefined {
	return values.find((value) => value !== rest);
}

/** Calls `read` every frame until the test ends, and records what it returns when it isn't `rest` */
function watch<T extends defined>(read: () => T, rest: T): T[] {
	const seen = new Array<T>();
	const connection = RunService.Heartbeat.Connect(() => {
		const value = read();
		if (value !== rest) seen.push(value);
	});
	defer(() => connection.Disconnect());
	return seen;
}

/**
 * The package with real keyboard and mouse input (UserInputService:CreateVirtualInput), which IAS
 * treats as hardware (design spec §6, "Real input", and §12)
 */
@Provider({ activeIn: ["testing"] })
export class RealInputTests implements OnStart {
	onStart() {
		defineTests("real-input", () => {
			// ---- the device

			// Studio's device simulator is Studio's setting, not the place's: a touch pass killed before
			// it set the device back (or a device picked by hand) turns every click into a tap in every
			// later window. Said once here, rather than by the mouse tests failing one by one
			test("outside the touch project Studio simulates no device: a click is mouse input", () => {
				if (isTouch()) return skip("not on a simulated phone");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const kinds = new Array<Enum.UserInputType>();
				const connection = UserInputService.InputBegan.Connect((input) => {
					const kind = input.UserInputType;
					if (kind === Enum.UserInputType.MouseButton1 || kind === Enum.UserInputType.Touch)
						kinds.push(kind);
				});
				defer(() => connection.Disconnect());
				real.Click(emptyPoint());
				eventually(() => kinds.size() > 0, "InputBegan for the click");
				expectEqual(
					kinds[0],
					Enum.UserInputType.MouseButton1,
					"Studio simulates a device: set it back with " +
						'StudioDeviceSimulatorService:SetDeviceAsync("default") ' +
						"(Places/TestingPlace/CLAUDE.md, The touch pass)",
				);
			});

			// ---- keys

			test("a real key presses a Bool action: Pressed, IsPressed, Released", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "the press");
				eventually(() => pressed.count === 1, "Pressed");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "the release");
				eventually(() => released.count === 1, "Released");
				expectEqual(pressed.count, 1);
			});

			test("real keys drive a composite Direction2D action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const move = createTestInput().Gameplay.Actions.Move;
				real.Press(K.W);
				real.Press(K.D);
				eventually(() => {
					const state = move.GetState();
					return state.X > 0 && state.Y > 0;
				}, "up and right");
				const state = move.GetState();
				expectTrue(nearlyEqual(state.X, state.Y), `a diagonal: ${state}`);
				expectTrue(state.Magnitude <= 1 + 1e-4, `clamped to one: ${state}`);
				real.Release(K.W);
				eventually(() => move.GetState() === new Vector2(1, 0), "right only");
				real.Release(K.D);
				eventually(() => move.GetState() === Vector2.zero, "at rest");
			});

			test("two keys on one action: the last one to change wins, for real keys too", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(KEYS_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const use = input.RealKeys.Actions.Use;
				// IAS's own behaviour: a second binding of the action, beside the schema's R
				const second = new Instance("InputBinding");
				second.Name = "UseSecond";
				second.KeyCode = K.F;
				second.Parent = use.Instance;
				defer(() => second.Destroy());
				real.Press(K.R);
				eventually(() => use.IsPressed(), "R");
				real.Press(K.F);
				frames(2);
				real.Release(K.R);
				eventually(() => !use.IsPressed(), "released with R, though F is still held");
				real.Release(K.F);
				frames(2);
				expectFalse(use.IsPressed());
			});

			test("a chord fires beside its plain key, and only when the modifier comes first", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(KEYS_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const { Copy, Plain } = input.RealKeys.Actions;

				real.Press(K.LeftControl);
				frames(2);
				real.Press(K.C);
				eventually(() => Copy.IsPressed() && Plain.IsPressed(), "Ctrl+C presses both");
				// letting go of the modifier releases the chord, not the plain key
				real.Release(K.LeftControl);
				eventually(() => !Copy.IsPressed(), "the chord released with Ctrl");
				expectTrue(Plain.IsPressed(), "C is still held");
				real.Release(K.C);
				eventually(() => !Plain.IsPressed(), "C released");

				// the key first, then the modifier: only the plain key
				real.Press(K.C);
				eventually(() => Plain.IsPressed(), "C");
				real.Press(K.LeftControl);
				frames(4);
				expectFalse(Copy.IsPressed(), "the modifier must come first");
				real.Release(K.LeftControl);
				real.Release(K.C);
				eventually(() => !Plain.IsPressed() && !Copy.IsPressed(), "both released");
			});

			test("after a rebind the action answers to the new key, and not to the old one", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				keys.Set(K.F);
				real.Press(K.F);
				eventually(() => jump.IsPressed(), "the new key");
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "released");
				real.Press(K.Space);
				frames(4);
				expectFalse(jump.IsPressed(), "the old key does nothing");
				real.Release(K.Space);
				frames(2);
				keys.Reset();
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "the default key after Reset");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released");
			});

			// ---- Capture

			test("Capture takes the next real key press; the action then answers to it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const changes = recordSignal(input.BindingsChanged);
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				real.Tap(K.G);
				eventually(() => captured.size() === 1, "the callback");
				expectEqual(captured[0], K.G);
				expectEqual(keys.Instance.KeyCode, K.G);
				eventually(() => changes.includes("Gameplay/Jump/KeyboardAndMouse"), "BindingsChanged");
				// the capture is over
				real.Tap(K.H);
				expectEqual(keys.Instance.KeyCode, K.G);
				expectEqual(captured.size(), 1);
				real.Press(K.G);
				eventually(() => jump.IsPressed(), "the captured key presses the action");
				real.Release(K.G);
				eventually(() => !jump.IsPressed(), "released");
			});

			test("Capture takes a key another action of a sinking context already uses", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const crouchKeys = input.Gameplay.Actions.Crouch.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				crouchKeys.Capture("KeyCode", (key) => captured.push(key));
				// Space is Jump's, in the same sinking context
				real.Tap(K.Space);
				eventually(() => captured.size() === 1, "the callback for a key in use");
				expectEqual(captured[0], K.Space);
				expectEqual(crouchKeys.Instance.KeyCode, K.Space);
			});

			test("Capture ignores keys the slot can't take; a cancel key and the returned function stop it", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const actions = input.Gameplay.Actions;

				// Direction2D's KeyCode takes sticks and deltas only: W is ignored
				const moveKeys = actions.Move.Bindings.KeyboardAndMouse;
				let moveCalls = 0;
				const stopMove = moveKeys.Capture("KeyCode", () => moveCalls++);
				real.Tap(K.W);
				expectEqual(moveCalls, 0);
				expectEqual(moveKeys.Instance.KeyCode, K.None);
				expectEqual(moveKeys.Instance.Up, K.W, "the composite is untouched");
				stopMove();

				// a cancel key ends it with no change; the next key changes nothing either
				const jumpKeys = actions.Jump.Bindings.KeyboardAndMouse;
				let jumpCalls = 0;
				jumpKeys.Capture("KeyCode", () => jumpCalls++, { Cancel: [K.Delete] });
				real.Tap(K.Delete);
				real.Tap(K.G);
				expectEqual(jumpCalls, 0);
				expectEqual(jumpKeys.Instance.KeyCode, K.Space);
			});

			test("Capture of a modifier ignores a mouse click and takes a key; the chord then works", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const quickSave = input.Gameplay.Actions.QuickSave;
				const keys = quickSave.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("PrimaryModifier", (key) => captured.push(key));
				// a mouse button (a touch, on a simulated phone) is no modifier
				real.Click(emptyPoint());
				expectEqual(captured.size(), 0);
				real.Tap(K.RightControl);
				eventually(() => captured.size() === 1, "the callback");
				expectEqual(captured[0], K.RightControl);
				expectEqual(keys.Instance.PrimaryModifier, K.RightControl);
				expectEqual(keys.Instance.KeyCode, K.S, "the key stays");

				real.Press(K.RightControl);
				frames(2);
				real.Press(K.S);
				eventually(() => quickSave.IsPressed(), "RightControl+S");
				real.Release(K.S);
				real.Release(K.RightControl);
				eventually(() => !quickSave.IsPressed(), "released");
			});

			// ---- contexts

			test("a sinking context blocks only the keys it binds; disabled, it lets them through", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(SINK_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const high = input.SinkHigh.Actions.Use;
				const { Use: low, Other: other } = input.SinkLow.Actions;

				real.Press(K.G);
				real.Press(K.H);
				eventually(() => high.IsPressed() && other.IsPressed(), "G above, H below");
				frames(2);
				expectFalse(low.IsPressed(), "G is sunk by the context above");
				real.Release(K.G);
				real.Release(K.H);
				eventually(() => !high.IsPressed() && !other.IsPressed(), "released");

				const release = input.SinkHigh.Request(false);
				real.Press(K.G);
				eventually(() => low.IsPressed(), "G reaches the context below");
				expectFalse(high.IsPressed());
				real.Release(K.G);
				eventually(() => !low.IsPressed(), "released");
				release();
			});

			test("InputCatcher blocks real keys from IAS until it lets go", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(SINK_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const other = input.SinkLow.Actions.Other;
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				catcher.GrabInput();
				real.Press(K.H);
				frames(4);
				expectFalse(other.IsPressed(), "caught");
				real.Release(K.H);
				frames(2);
				catcher.ReleaseInput();
				real.Press(K.H);
				eventually(() => other.IsPressed(), "through once released");
				real.Release(K.H);
				eventually(() => !other.IsPressed(), "released");
			});

			test("the focus-loss reset releases an action held by a real key", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "the press");
				const box = newTextBox();
				box.CaptureFocus();
				eventually(() => !jump.IsPressed(), "released when the TextBox takes focus");
				eventually(() => input.Gameplay.IsEnabled(), "the context back on");
				frames(4);
				expectFalse(jump.IsPressed(), "still released: the TextBox has the key now");
				expectEqual(released.count, 1);
				real.Release(K.Space);
				frames(2);
				box.ReleaseFocus();
				eventually(() => UserInputService.GetFocusedTextBox() === undefined, "the focus released");
				frames(2);
				real.Press(K.Space);
				eventually(() => jump.IsPressed(), "the key works again");
				real.Release(K.Space);
				eventually(() => !jump.IsPressed(), "released");
			});

			// ---- the mouse

			test("AttachButton with a real click; the button keeps the click from a MouseLeftButton action", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { Jump, Fire } = createTestInput().Gameplay.Actions;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const activated = countSignal(button.Activated);
				Jump.AttachButton(button);

				real.MouseDown(screenCenter(button));
				eventually(() => Jump.IsPressed(), "the button's binding");
				frames(2);
				expectFalse(Fire.IsPressed(), "the click on the button never reaches MouseLeftButton");
				real.MouseUp();
				eventually(() => !Jump.IsPressed(), "released with the button");
				eventually(() => activated.count === 1, "Activated");

				// on empty space the MouseLeftButton action takes it. Sent at once after Activated, the
				// press was lost now and then (no InputBegan, the cursor not moved: a third of the runs of
				// every section in a project): MouseDown waits two frames after a release now
				const seen = new Array<string>();
				const began = UserInputService.InputBegan.Connect((input, processed) => {
					seen.push(
						`${input.UserInputType.Name} at ${input.Position}${processed ? ", processed" : ""}`,
					);
				});
				defer(() => began.Disconnect());
				const point = emptyPoint();
				real.MouseDown(point);
				const deadline = os.clock() + 5;
				while (!Fire.IsPressed() && os.clock() < deadline) frames(1);
				if (!Fire.IsPressed())
					fail(
						`expected MouseLeftButton to hold within 5 seconds of a click at ${point}; Jump ` +
							`${Jump.IsPressed() ? "held" : "not held"}, Activated ${activated.count}; ` +
							`InputBegan: ${seen.size() === 0 ? "nothing" : seen.join(", ")}; ` +
							`Fire's action ${Fire.Instance.GetState()}, Enabled ${Fire.Instance.Enabled}; ` +
							`${pointerReport(point)}${real.FocusNote()}`,
					);
				expectFalse(Jump.IsPressed());
				real.MouseUp();
				eventually(() => !Fire.IsPressed(), "released");
			});

			test("the mouse wheel reads as a rate for one frame, the Scroll preset's too", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = InputActions.Create(WHEEL_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const raw = recordSignal(input.Wheel.Actions.Raw.StateChanged);
				const scroll = recordSignal(input.Ui.Actions.Scroll.StateChanged);

				real.Wheel(1);
				eventually(() => raw.size() >= 2 && raw[raw.size() - 1] === 0, "a value, then 0");
				const notch = expectDefined(firstMoved(raw, 0), "a value");
				// one notch over one frame's time: about the frame rate, never 1
				expectTrue(notch > 5 && notch < 2000, `one notch reads ${notch}: notches per second`);
				expectEqual(input.Wheel.Actions.Raw.GetState(), 0, "back to 0");
				eventually(
					() => scroll.size() >= 2 && scroll[scroll.size() - 1] === 0,
					"Scroll: a value, then 0",
				);
				const scrolled = expectDefined(firstMoved(scroll, 0), "Scroll's value");
				// the preset leaves ClampMagnitudeToOne at its default, which a single key source ignores
				expectTrue(
					nearlyEqual(scrolled, notch, 1e-3),
					`Scroll reads ${scrolled}, the raw wheel ${notch}`,
				);

				real.Wheel(-1);
				eventually(() => raw.some((value) => value < 0), "the other way");
				const back = raw.find((value) => value < 0)!;
				expectTrue(back < -5, `one notch back reads ${back}`);
				eventually(() => raw[raw.size() - 1] === 0, "0 again");
			});

			test("mouse movement reads as a rate while the cursor is locked, scaled by the binding", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const look = createTestInput().Gameplay.Actions.Look;
				const values = recordSignal(look.StateChanged);
				if (!moveLockedMouse(real, new Vector2(10, 5))) return skip(CURSOR_UNLOCKED);
				eventually(() => firstMoved(values, Vector2.zero) !== undefined, "a value");
				eventually(() => look.GetState() === Vector2.zero, "back to rest");
				const moved = firstMoved(values, Vector2.zero)!;
				// Scale 0.02, Vector2Scale (1, -1): right stays right, down becomes up
				expectTrue(moved.X > 0 && moved.Y < 0, `${moved}`);
				expectTrue(nearlyEqual(moved.X / -moved.Y, 2, 0.01), `the ratio of 10 to 5: ${moved}`);
				// 10 px * 0.02 = 0.2 in one frame: as a rate, that over the frame's time
				expectTrue(moved.X > 0.2 * 5, `10 px reads ${moved.X}: pixels per second, scaled`);
			});

			test("RawInputHandler reads real wheel and mouse movement", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				RawInputHandler.Initialize();
				const zooms = watch(() => RawInputHandler.GetZoomDelta(), 0);
				real.Wheel(1);
				eventually(() => zooms.size() > 0, "a zoom");
				const zoomIn = zooms[0];
				// the action's rate times the frame's time: notches, not notches per second
				expectTrue(math.abs(zoomIn) < 20, `one notch zooms ${zoomIn}`);
				zooms.clear();
				frames(3);
				zooms.clear();
				real.Wheel(-1);
				eventually(() => zooms.size() > 0, "a zoom back");
				expectTrue(zooms[0] * zoomIn < 0, `the other way: ${zooms[0]} after ${zoomIn}`);

				const rotations = watch(() => RawInputHandler.GetRotation(), Vector2.zero);
				if (!moveLockedMouse(real, new Vector2(20, 0)))
					return skip(`${CURSOR_UNLOCKED}: rotation untested`);
				eventually(() => rotations.size() > 0, "a rotation");
				expectTrue(rotations[0].X !== 0, `${rotations[0]}`);
			});

			// Wheel notches zoom the player's camera too. Four in from the start put it in first person,
			// which locks the cursor at the centre, and every later click then misses its button (hunt
			// round 3, H3-F3): RealInput sends a test's notches back when it ends
			test("RealInput sends a test's wheel notches back: the camera ends at the zoom it started with", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const camera = expectDefined(Workspace.CurrentCamera, "the camera");
				const zoom = () => camera.CFrame.Position.sub(camera.Focus.Position).Magnitude;
				// The camera eases to a new zoom over several frames
				const settled = () => {
					let last = zoom();
					for (let index = 0; index < 40; index++) {
						frames(4);
						const now = zoom();
						if (math.abs(now - last) < 1e-3) return now;
						last = now;
					}
					return last;
				};
				const start = settled();
				// A RealInput of its own, whose end this test calls itself
				const inner = new RealInput(real.Device);
				inner.Wheel(1);
				frames(3);
				inner.Wheel(1);
				frames(3);
				inner.Wheel(-1);
				frames(3);
				inner.Wheel(1);
				const zoomedIn = settled();
				if (zoomedIn > start - 0.5)
					return skip(`the camera didn't zoom with the wheel (${start} to ${zoomedIn})`);
				inner.ReleaseAll();
				const sentBack = settled();
				expectTrue(
					math.abs(sentBack - start) < start * 0.15,
					`zoom ${start} at the start, ${zoomedIn} after two notches in, ${sentBack} after ReleaseAll`,
				);
				expectTrue(
					UserInputService.MouseBehavior !== Enum.MouseBehavior.LockCenter,
					"not in first person",
				);
				// Sent back already: the test's own end sends nothing more
				inner.ReleaseAll();
				expectTrue(math.abs(settled() - sentBack) < 1e-2, "a second ReleaseAll changes nothing");
			});

			// ---- UI navigation

			test("with a button selected, Return activates it and reaches neither its binding nor IAS", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				input.Ui.SetEnabled(true);
				const accept = countSignal(input.Ui.Actions.Accept.Pressed);
				const jump = input.Gameplay.Actions.Jump;
				const jumps = countSignal(jump.Pressed);
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				const activated = countSignal(button.Activated);
				defer(() => {
					GuiService.SelectedObject = undefined;
				});
				GuiService.SelectedObject = button;
				frames(3);
				if (GuiService.SelectedObject !== button) return skip("the button can't be selected here");
				real.Tap(K.Return);
				eventually(() => activated.count === 1, "Return activates the selected button");
				frames(3);
				expectEqual(jumps.count, 0, "its UIButton binding never fires");
				expectEqual(accept.count, 0, "Return never reaches the Accept action");
				GuiService.SelectedObject = undefined;
				frames(2);
				real.Tap(K.Return);
				eventually(() => accept.count === 1, "with nothing selected, Return is Accept's");
			});
		});

		defineTests("touch", () => {
			test("Studio simulates a phone: a tap is touch input, and PreferredInput is Touch", () => {
				if (!isTouch()) return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(UserInputService.TouchEnabled, "TouchEnabled");
				const touches = countSignal(UserInputService.TouchStarted);
				real.Click(emptyPoint());
				eventually(() => touches.count === 1, "TouchStarted for the tap");
				eventually(
					() => UserInputService.PreferredInput === Enum.PreferredInput.Touch,
					"PreferredInput Touch",
				);
			});

			test("PreferredBinding follows the device to the touch binding", () => {
				if (!isTouch()) return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				jump.AttachButton(button);
				const touchBinding = jump.Instance.FindFirstChild("JumpUIButton1");
				const keyBinding = jump.Bindings.KeyboardAndMouse.Instance;

				real.Tap(K.Space);
				eventually(
					() => UserInputService.PreferredInput === Enum.PreferredInput.KeyboardAndMouse,
					`PreferredInput after a key: ${UserInputService.PreferredInput}`,
				);
				eventually(() => jump.GetPreferredBinding() === keyBinding, "the key binding");
				real.Click(emptyPoint());
				eventually(
					() => UserInputService.PreferredInput === Enum.PreferredInput.Touch,
					"PreferredInput Touch",
				);
				eventually(
					() => jump.GetPreferredBinding() === touchBinding,
					`the touch binding, not ${jump.GetPreferredBinding()}`,
				);
			});

			test("AttachButton with a tap", () => {
				if (!isTouch()) return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const pressed = countSignal(jump.Pressed);
				const activated = countSignal(button.Activated);
				jump.AttachButton(button);
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "pressed while the finger is down");
				real.MouseUp();
				eventually(() => !jump.IsPressed(), "released with the finger");
				eventually(() => activated.count === 1, "Activated");
				expectEqual(pressed.count, 1);
			});

			test("TouchPosition bindings: a Bool held by a finger, limited to a UIModifier region", () => {
				if (!isTouch()) return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					TouchArea: {
						Priority: 2500,
						Actions: {
							Anywhere: InputActions.Bool({ Touch: K.TouchPosition }),
							InRegion: InputActions.Bool({ Touch: K.TouchPosition }),
							Where: InputActions.ViewportPosition({ Touch: K.TouchPosition }),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder() });
				defer(() => input.Destroy());
				const { Anywhere, InRegion, Where } = input.TouchArea.Actions;
				const region = testButton(testGui(), "Region", 0.3);
				const problem = clickProblem(region);
				if (problem !== undefined) return skip(problem);
				InRegion.Bindings.Touch.Instance.UIModifier = region;

				const outside = emptyPoint();
				real.MouseDown(outside);
				eventually(() => Anywhere.IsPressed(), "a finger down anywhere");
				frames(2);
				expectFalse(InRegion.IsPressed(), "outside the region");
				eventually(() => Where.GetState() !== Vector2.zero, "the finger's position");
				const where = Where.GetState();
				expectTrue(
					where.sub(outside).Magnitude < 2 || where.sub(outside.sub(guiInset())).Magnitude < 2,
					`ViewportPosition ${where} for a finger at ${outside}`,
				);
				real.MouseUp();
				eventually(() => !Anywhere.IsPressed(), "the finger up");

				real.MouseDown(screenCenter(region));
				eventually(() => InRegion.IsPressed(), "a finger down in the region");
				real.MouseUp();
				eventually(() => !InRegion.IsPressed(), "the finger up");
			});
		});
	}
}
