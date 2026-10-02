import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import {
	GuiService,
	Players,
	ReplicatedStorage,
	RunService,
	UserInputService,
	Workspace,
} from "@rbxts/services";
import { expectedServerAuthority } from "shared/fixtures/authority";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frames, nearlyEqual, newFolder, recordSignal } from "./helpers";
import { clickProblem, guiInset, realInput, screenCenter, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

const serverJump = () => server("state", "sa", "SaGameplay", "Jump");
const serverEmote = () => server("copyState", "sa", "SaGameplay", "Emote");
/** How many times the server's Jump fired Pressed this session */
const serverPressed = () => server("pressed", "sa") as number;

/** SA_SCHEMA on the server's copy (the template binds Jump to F, and its extra Emote to H) */
function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	let destroyed = false;
	defer(() => {
		if (!destroyed) input.Destroy();
	});
	eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy");
	const destroy = () => {
		destroyed = true;
		input.Destroy();
	};
	return { input, destroy };
}

/**
 * Leaves an action of the server's copy at rest after the test, on the client and the server,
 * whatever the test left there: a same-frame pair on a Scriptable binding made for it
 */
function settleAfter(action: InputAction) {
	defer(() => {
		if (action.Parent === undefined || !action.Enabled) return;
		const binding = new Instance("InputBinding");
		binding.Name = "HunterR4Settle";
		binding.Type = Enum.InputBindingType.Scriptable;
		binding.Parent = action;
		pcall(() => {
			binding.Fire(true);
			binding.Fire(false);
		});
		binding.Destroy();
		frames(3);
	});
}

/** The Pressed/Released sequence of a Bool action until the test ends, as "P" and "R" */
function recordPresses(action: InputActions.BoolAction) {
	const events = new Array<string>();
	const pressed = action.Pressed.Connect(() => events.push("P"));
	const released = action.Released.Connect(() => events.push("R"));
	defer(() => {
		pressed.Disconnect();
		released.Disconnect();
	});
	return events;
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

/** A TextBox low on the screen, clear of the test buttons; focus released after the test */
function newTextBox() {
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Position = UDim2.fromScale(0.3, 0.75);
	box.Text = "";
	box.Parent = testGui("InputActionsHunterR4TextBox");
	defer(() => box.ReleaseFocus());
	return box;
}

/** Whether "P" and "R" alternate, starting with "P" */
function alternates(events: readonly string[]) {
	for (let index = 0; index < events.size(); index++) {
		if (events[index] !== (index % 2 === 0 ? "P" : "R")) return false;
	}
	return true;
}

/** A context of the test's own under the local player, standing in for a server's copy */
function fakeCopy(folderName: string, contextName: string, actions: string[]) {
	const folder = new Instance("Folder");
	folder.Name = folderName;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const name of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Parent = context;
	}
	context.Parent = folder;
	defer(() => folder.Destroy());
	return { folder, context };
}

/** Two schemas on one Server Authority context: the second has an action the first lacks */
const SWAP_SMALL = InputActions.Schema({
	HunterR4Swap: {
		ServerAuthority: true,
		Actions: { Fire: InputActions.Bool({ Pad: K.ButtonR2 }) },
	},
});
const SWAP_FULL = InputActions.Schema({
	HunterR4Swap: {
		ServerAuthority: true,
		Actions: {
			Fire: InputActions.Bool({ Pad: K.ButtonR2 }),
			Extra: InputActions.Bool({ Key: K.K }),
		},
	},
});

/**
 * Hunt round 4: the package with real input (VirtualInput) around this round's work: the place's
 * mode (`IsServerAuthority`) deciding the releases, the stand-in swap, the focus-loss reset, and
 * the docs' claims about UI navigation
 */
@Provider({ activeIn: ["testing"] })
export class HunterR4RealTests implements OnStart {
	onStart() {
		defineTests("hunter-r4-real", () => {
			// ---- the place's mode and the releases (IsServerAuthority)

			// Destroy removes the template's keys the package gave an action the schema doesn't mention
			// (the template's Emote, bound to H). A held binding that is destroyed leaves its action
			// stuck on (probed), so the package fires a release pair through ReleaseOnServer first. Since
			// hunt round 3 that pair is skipped where IsServerAuthority() is false, and nothing else
			// releases the action: on a local copy it stays pressed after H comes up
			test("a provided copy: Destroy while a real key holds a template action the schema doesn't mention leaves it at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, destroy } = createSaInput();
				const emote = expectDefined(
					input.SaGameplay.Instance.FindFirstChild("Emote"),
					"the template's Emote on the copy",
				) as InputAction;
				settleAfter(emote);
				expectDefined(emote.FindFirstChild("EmoteKeyboardAndMouse"), "the template's H binding");
				real.Press(K.H);
				eventually(() => emote.GetState() === true, "H presses Emote on the copy");
				destroy();
				frames(3);
				expectEqual(emote.FindFirstChild("EmoteKeyboardAndMouse"), undefined, "the binding went");
				real.Release(K.H);
				frames(6);
				expectFalse(
					emote.GetState() as boolean,
					`Emote on the client after Destroy and H up (IsServerAuthority ${InputActions.IsServerAuthority()}, project ${getProject()})`,
				);
				if (expectedServerAuthority() === true)
					eventually(() => serverEmote() === false, "Emote at rest on the server");
			});

			// The template's extra goes through ReleaseOnServer's binding made and destroyed in one frame
			// when its context is disabled. Its key comes up while the context is off; enabled again, the
			// client's own state must not come back (design spec §8, "Releasing on the server")
			test("a provided copy: a template action held by a real key, its context held off while the key comes up, stays at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input } = createSaInput();
				const emote = expectDefined(
					input.SaGameplay.Instance.FindFirstChild("Emote"),
					"the template's Emote on the copy",
				) as InputAction;
				settleAfter(emote);
				const authority = expectedServerAuthority() === true;
				real.Press(K.H);
				eventually(() => emote.GetState() === true, "H presses Emote on the copy");
				if (authority) eventually(() => serverEmote() === true, "the server's Emote held");
				const release = input.SaGameplay.Request(false);
				eventually(() => emote.GetState() === false, "released with its context");
				if (authority) eventually(() => serverEmote() === false, "released on the server");
				real.Release(K.H);
				frames(5);
				release();
				frames(10);
				expectFalse(emote.GetState() as boolean, "Emote on the client once the context is back");
				if (authority) {
					task.wait(0.5);
					expectEqual(serverEmote(), false, "Emote on the server once the context is back");
				}
			});

			// A rebind onto a key that is down already, while the action rests: nothing may stick
			test("a rebind onto a key that is already down, while the action rests, leaves nothing stuck: local context", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const events = recordPresses(jump);
				real.Press(K.G);
				frames(3);
				expectFalse(jump.IsPressed(), "G is not Jump's yet");
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(6);
				const whileHeld = jump.IsPressed();
				real.Release(K.G);
				frames(6);
				expectFalse(jump.IsPressed(), `after G came up (pressed while held: ${whileHeld})`);
				real.Press(K.G);
				eventually(() => jump.IsPressed(), "G presses Jump");
				real.Release(K.G);
				eventually(() => !jump.IsPressed(), "released");
				expectTrue(alternates(events), events.join(""));
			});

			test("a rebind onto a key that is already down, while the action rests, leaves nothing stuck: the server's copy", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input } = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				settleAfter(jump.Instance);
				const authority = expectedServerAuthority() === true;
				const events = recordPresses(jump);
				real.Press(K.G);
				frames(3);
				expectFalse(jump.IsPressed(), "G is not Jump's yet");
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				frames(6);
				const whileHeld = jump.IsPressed();
				real.Release(K.G);
				// The copy's state moves on simulation steps under Server Authority (60 Hz, a frame is
				// about 5 ms): wait for it rather than a fixed few frames (worker, round 4, H4-F4)
				eventually(() => !jump.IsPressed(), `after G came up (pressed while held: ${whileHeld})`);
				if (authority) {
					task.wait(0.5);
					expectEqual(serverJump(), false, "the server's Jump after G came up");
				}
				real.Press(K.G);
				eventually(() => jump.IsPressed(), "G presses Jump");
				if (authority) eventually(() => serverJump() === true, "and the server's");
				real.Release(K.G);
				eventually(() => !jump.IsPressed(), "released");
				if (authority) eventually(() => serverJump() === false, "released on the server");
				expectTrue(alternates(events), events.join(""));
			});

			// The control: an action the schema has is reset by Destroy (an Enabled toggle) everywhere
			test("a provided copy: Destroy while a real key holds a schema action leaves it at rest", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input, destroy } = createSaInput();
				const jump = input.SaGameplay.Actions.Jump.Instance;
				settleAfter(jump);
				real.Press(K.F);
				eventually(() => jump.GetState() === true, "F presses Jump on the copy");
				destroy();
				frames(3);
				real.Release(K.F);
				frames(6);
				expectFalse(jump.GetState() as boolean, "Jump on the client after Destroy and F up");
				if (expectedServerAuthority() === true)
					eventually(() => serverJump() === false, "Jump at rest on the server");
			});

			// docs/Advanced.md, Server Authority: "A context marked ServerAuthority: true in a place
			// without Server Authority still works on the client ..., but the server never receives its
			// state: ForPlayer(...).GetState() stays at rest"
			test("docs: a marked context works on the client; the server receives its state only under Server Authority", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { input } = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				settleAfter(jump.Instance);
				const before = serverPressed();
				real.Press(K.F);
				eventually(() => jump.IsPressed(), "F presses Jump on the client");
				if (expectedServerAuthority() === true) {
					eventually(() => serverJump() === true, "the server receives the press");
				} else {
					task.wait(1);
					expectEqual(serverJump(), false, "the server's Jump");
					expectEqual(serverPressed(), before, "the server's Pressed count");
				}
				real.Release(K.F);
				eventually(() => !jump.IsPressed(), "released on the client");
				if (expectedServerAuthority() === true)
					eventually(() => serverJump() === false, "released on the server");
			});

			// ---- the stand-in swap

			test("Capture started on a stand-in takes a key after the swap: the key then presses the copy's action", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					HunterR4Capture: {
						ServerAuthority: true,
						Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: "HunterR4CaptureCopy",
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const jump = input.HunterR4Capture.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				expectFalse(input.HunterR4Capture.IsLinkedToServer());
				const { folder } = fakeCopy("HunterR4CaptureCopy", "HunterR4Capture", ["Jump"]);
				folder.Parent = Players.LocalPlayer;
				eventually(() => input.HunterR4Capture.IsLinkedToServer(), "the swap");
				expectTrue(jump.Instance.IsDescendantOf(folder), "the handle is on the copy");
				real.Tap(K.G);
				eventually(() => captured.size() === 1, "the key captured after the swap");
				expectEqual(captured[0], K.G);
				expectEqual(keys.Instance.KeyCode, K.G);
				expectEqual(keys.Instance.Parent, jump.Instance, "the binding is under the copy's Jump");
				real.Press(K.G);
				eventually(() => jump.IsPressed(), "G presses the copy's Jump");
				real.Release(K.G);
				eventually(() => !jump.IsPressed(), "released");
				expectTrue(
					input.ExportBindings().find('"KeyCode":"G"', 1, true)[0] !== undefined,
					input.ExportBindings(),
				);
			});

			// The worker's round 3 fix to CarryChanges, untested so far: a handle that swaps onto a
			// binding another handle made on the copy writes only what it changed, and leaves that
			// binding's stored ReleasedThreshold (design spec §6, Writing bindings: "the swap when the
			// stand-in kept it")
			test("swap onto another handle's binding: a PressedThreshold carried over keeps that binding's stored ReleasedThreshold", () => {
				const folderName = "HunterR4SwapCopy";
				const full = InputActions.Create(SWAP_FULL, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => full.Destroy());
				// the copy arrives with Fire only: the first handle waits on its stand-in for Extra
				const { folder, context } = fakeCopy(folderName, "HunterR4Swap", ["Fire"]);
				folder.Parent = Players.LocalPlayer;
				frames(3);
				expectFalse(full.HunterR4Swap.IsLinkedToServer(), "waiting for Extra");
				const small = InputActions.Create(SWAP_SMALL, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => small.Destroy());
				expectTrue(small.HunterR4Swap.IsLinkedToServer(), "the second handle found the copy");
				const smallPad = small.HunterR4Swap.Actions.Fire.Bindings.Pad;
				smallPad.Set({ KeyCode: K.ButtonR2, ReleasedThreshold: 0.45 });
				smallPad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.3 });
				expectTrue(
					nearlyEqual(smallPad.Instance.ReleasedThreshold, 0.3),
					`stored 0.45 reads ${smallPad.Instance.ReleasedThreshold} under 0.3`,
				);
				// the stand-in's handle tunes only PressedThreshold
				full.HunterR4Swap.Actions.Fire.Bindings.Pad.Set({
					KeyCode: K.ButtonR2,
					PressedThreshold: 0.4,
				});
				const extra = new Instance("InputAction");
				extra.Name = "Extra";
				extra.Parent = context;
				eventually(() => full.HunterR4Swap.IsLinkedToServer(), "the swap once Extra is there");
				const fullPad = full.HunterR4Swap.Actions.Fire.Bindings.Pad;
				expectEqual(fullPad.Instance, smallPad.Instance, "one binding for both handles");
				expectTrue(
					nearlyEqual(fullPad.Instance.PressedThreshold, 0.4),
					`PressedThreshold ${fullPad.Instance.PressedThreshold}: the stand-in's 0.4 carried over`,
				);
				smallPad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.9 });
				expectTrue(
					nearlyEqual(smallPad.Instance.ReleasedThreshold, 0.45),
					`ReleasedThreshold reads ${smallPad.Instance.ReleasedThreshold} under 0.9: the stored 0.45 should show`,
				);
			});

			// ---- the focus-loss reset with real input

			test("a button held by a real click when a TextBox takes focus: released, one false/true pair, at rest once the mouse comes up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				jump.AttachButton(button);
				const events = recordPresses(jump);
				const gameplay = recordSignal(input.Gameplay.EnabledChanged);
				const menu = recordSignal(input.Menu.EnabledChanged);
				real.MouseDown(screenCenter(button));
				eventually(() => jump.IsPressed(), "pressed by the button");
				const box = newTextBox();
				box.CaptureFocus();
				eventually(() => !jump.IsPressed(), "released by the focus-loss reset");
				eventually(() => gameplay.size() >= 2, "Gameplay back on");
				frames(5);
				const during = jump.IsPressed();
				real.MouseUp();
				frames(6);
				expectFalse(
					jump.IsPressed(),
					`after the mouse came up (pressed again while the TextBox had focus: ${during}; events ${events.join("")})`,
				);
				expectTrue(alternates(events), events.join(""));
				expectEqual(gameplay.map((value) => tostring(value)).join(","), "false,true");
				expectEqual(menu.size(), 0, "the disabled Menu hears nothing");
				expectFalse(input.Menu.IsEnabled());
			});

			// ---- Capture with real keys

			// A player who rebinds Ctrl+S to Ctrl+D presses Ctrl first. Capture("KeyCode") takes the
			// first key that begins and is legal for the slot, and Ctrl is: the binding becomes Ctrl
			// with the modifier Ctrl
			test("Capture('KeyCode') on a chord, Ctrl then D: the binding it makes still fires", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const quickSave = createTestInput().Gameplay.Actions.QuickSave;
				const keys = quickSave.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				real.Press(K.LeftControl);
				frames(2);
				real.Press(K.D);
				frames(3);
				real.Release(K.D);
				real.Release(K.LeftControl);
				frames(3);
				eventually(() => captured.size() === 1, "a key captured");
				const made = `${keys.Instance.PrimaryModifier.Name}+${keys.Instance.KeyCode.Name}`;
				// pressing the binding as made, modifier first
				const modifier = keys.Instance.PrimaryModifier;
				const key = keys.Instance.KeyCode;
				let fired = false;
				const connection = quickSave.Pressed.Connect(() => {
					fired = true;
				});
				defer(() => connection.Disconnect());
				if (modifier !== K.None && modifier !== key) {
					real.Press(modifier);
					frames(2);
				}
				real.Press(key);
				frames(6);
				real.ReleaseAll();
				expectTrue(
					fired,
					`Capture took ${captured[0].Name}: the binding ${made} never presses QuickSave`,
				);
			});

			// ---- the VirtualInput helpers: inset handling

			// virtual.ts screenCenter, and design spec §12: "SendMouseButton positions are screen positions
			// including the GUI inset: AbsolutePosition + inset". The tests' 120 px buttons hide an error
			// of a few dozen pixels; an 8 px one doesn't
			test("a click (a tap on the phone) at screenCenter hits a small button", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const gui = testGui("InputActionsHunterR4Small");
				const button = new Instance("TextButton");
				button.AnchorPoint = new Vector2(0.5, 0.5);
				button.Position = UDim2.fromScale(0.3, 0.3);
				button.Size = UDim2.fromOffset(8, 8);
				button.Parent = gui;
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				let activated = 0;
				const connection = button.Activated.Connect(() => activated++);
				defer(() => connection.Disconnect());
				const at = screenCenter(button);
				// where the engine says the click or tap landed (InputObject.Position is in GUI space)
				const landed = new Array<string>();
				const began = UserInputService.InputBegan.Connect((input) => {
					landed.push(`${input.UserInputType.Name} at ${input.Position}`);
				});
				defer(() => began.Disconnect());
				real.Click(at);
				frames(3);
				const camera = Workspace.CurrentCamera!;
				const inset = guiInset();
				const hit = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui")!
					.GetGuiObjectsAtPosition(at.X - inset.X, at.Y - inset.Y)
					.map((object) => object.GetFullName());
				expectEqual(
					activated,
					1,
					`a click at ${at}: button at ${button.AbsolutePosition} size ${button.AbsoluteSize}, inset ${inset}, gui ${gui.AbsolutePosition} ${gui.AbsoluteSize}, viewport ${camera.ViewportSize}; landed: ${landed.join("; ")}; GUI there: ${hit.join(", ")}`,
				);
			});

			// ---- UI navigation (docs/Advanced.md, IAS behaviours to know)

			// "while a GuiButton is selected ..., Return and the arrow keys never reach IAS". The probe
			// behind it tried Return and Right; Right is sunk by the legacy camera anyway
			test("docs: while a button is selected, Up and Down never reach IAS either", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createTestInput();
				input.Ui.SetEnabled(true);
				const navigate = input.Ui.Actions.Navigate;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				defer(() => {
					GuiService.SelectedObject = undefined;
				});
				GuiService.SelectedObject = button;
				frames(3);
				if (GuiService.SelectedObject !== button) return skip("the button can't be selected here");
				const seen = watch(() => navigate.GetState(), Vector2.zero);
				real.Tap(K.Up);
				real.Tap(K.Down);
				frames(3);
				expectEqual(
					seen.size(),
					0,
					`Navigate moved while ${GuiService.SelectedObject?.GetFullName()} was selected: ${seen.join(", ")}`,
				);
				GuiService.SelectedObject = undefined;
				frames(2);
				real.Press(K.Up);
				eventually(() => navigate.GetState().Y > 0, "Up reaches Navigate with nothing selected");
				real.Release(K.Up);
				eventually(() => navigate.GetState() === Vector2.zero, "at rest");
			});
		});
	}
}
