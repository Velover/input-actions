import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, Players } from "@rbxts/services";
import { createTestInput, frame, frames, newFolder, recordSignal } from "./helpers";

// Validator round 6: adversarial client tests. Most play the server's copy of a Server Authority
// context on the client, under a player folder no server provides, so they run in every project.

const K = Enum.KeyCode;
const EMPTY_SAVE = '{"Version":1,"Bindings":{}}';

let folderCount = 0;
/** A player folder name no server provides: the tests play the server's copy on the client */
function uniqueFolderName() {
	folderCount++;
	return `ValidatorR6Copy${folderCount}`;
}

/** The server's copy, played on the client: parented last, as ProvideToPlayers does */
function localCopy(
	folderName: string,
	contextName: string,
	actions: Array<[string, Enum.InputActionType]>,
): InputContext {
	const folder = new Instance("Folder");
	folder.Name = folderName;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const [name, actionType] of actions) addAction(context, name, actionType);
	context.Parent = folder;
	folder.Parent = Players.LocalPlayer;
	defer(() => folder.Destroy());
	return context;
}

function addAction(context: InputContext, name: string, actionType: Enum.InputActionType) {
	const action = new Instance("InputAction");
	action.Name = name;
	action.Type = actionType;
	action.Parent = context;
	return action;
}

// One Server Authority context, as two schemas see it. SMALL is satisfied by a copy with Poke and
// Move; LARGE also needs Extra, so a root handle made with it waits on a stand-in until Extra is
// added to the copy. LARGE_OTHER_KEY declares another default key for Poke's KeyboardAndMouse slot.
const SMALL = InputActions.Schema({
	R6Adopt: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
			Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
		},
	},
});
const LARGE = InputActions.Schema({
	R6Adopt: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
			Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
			Extra: InputActions.Bool({ KeyboardAndMouse: K.X }),
		},
	},
});
const LARGE_OTHER_KEY = InputActions.Schema({
	R6Adopt: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.O }),
			Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
			Extra: InputActions.Bool({ KeyboardAndMouse: K.X }),
		},
	},
});

/**
 * A root handle on the server's copy (SMALL) and one on a stand-in (the larger schema), then the
 * rest of the copy arrives and the second swaps onto the instances the first already uses.
 */
function copyAndStandIn(large: typeof LARGE) {
	const folderName = uniqueFolderName();
	const copy = localCopy(folderName, "R6Adopt", [
		["Poke", Enum.InputActionType.Bool],
		["Move", Enum.InputActionType.Direction2D],
	]);
	const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
	const onCopy = InputActions.Create(SMALL, options);
	defer(() => onCopy.Destroy());
	expectTrue(onCopy.R6Adopt.IsLinkedToServer(), "the first handle is on the copy");
	const waiting = InputActions.Create(large, options);
	defer(() => waiting.Destroy());
	expectFalse(waiting.R6Adopt.IsLinkedToServer(), "the copy lacks Extra: a stand-in");
	const arrive = () => {
		addAction(copy, "Extra", Enum.InputActionType.Bool);
		eventually(() => waiting.R6Adopt.IsLinkedToServer(), "the swap");
		expectEqual(waiting.R6Adopt.Instance, copy);
	};
	return { copy, onCopy, waiting, arrive };
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR6ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r6", () => {
			// ---- the swap onto bindings another root handle already made on the copy (spec
			// section 4: destroying one handle never releases input another live handle holds;
			// every handle on a binding has the first handle's defaults. Section 8: the swap carries
			// rebinds and held Scriptable values over)

			test("a press the copy's handle fired stays held when a stand-in handle that fired it too is destroyed after the swap", () => {
				const { onCopy, waiting, arrive } = copyAndStandIn(LARGE);
				const held = onCopy.R6Adopt.Actions.Poke;
				held.Fire(true);
				eventually(() => held.IsPressed(), "the copy's handle holds Poke");
				waiting.R6Adopt.Actions.Poke.Fire(true);
				expectTrue(waiting.R6Adopt.Actions.Poke.IsPressed(), "pressed on the stand-in too");
				arrive();
				eventually(() => waiting.R6Adopt.Actions.Poke.IsPressed(), "pressed after the swap");
				waiting.Destroy();
				frames(3);
				expectTrue(
					held.IsPressed(),
					"the copy's handle still holds its press: its Fire(true) was never undone",
				);
				held.Fire(false);
			});

			test("a virtual stick the copy's handle holds stays when a stand-in handle that fired the same value is destroyed after the swap", () => {
				const { onCopy, waiting, arrive } = copyAndStandIn(LARGE);
				const value = new Vector2(0, 1);
				const move = onCopy.R6Adopt.Actions.Move;
				move.Bindings.Virtual.Fire(value);
				eventually(() => move.GetState() === value, "the copy's handle holds the stick");
				waiting.R6Adopt.Actions.Move.Bindings.Virtual.Fire(value);
				arrive();
				waiting.Destroy();
				frames(3);
				expectEqual(move.GetState(), value, "the copy's handle still holds (0, 1)");
				move.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("a rebind made on the stand-in survives the swap onto a binding the copy's handle made", () => {
				const { waiting, arrive } = copyAndStandIn(LARGE);
				const poke = waiting.R6Adopt.Actions.Poke.Bindings.KeyboardAndMouse;
				poke.Set(K.Q);
				expectEqual(poke.Instance.KeyCode, K.Q);
				const saved = waiting.ExportBindings();
				arrive();
				expectEqual(poke.Instance.KeyCode, K.Q, "the rebind is still in effect after the swap");
				expectEqual(waiting.ExportBindings(), saved, "and still exported");
			});

			test("a save imported on the stand-in survives the swap onto a binding the copy's handle made", () => {
				const { waiting, arrive } = copyAndStandIn(LARGE);
				const save = HttpService.JSONEncode({
					Version: 1,
					Bindings: { "R6Adopt/Poke/KeyboardAndMouse": { KeyCode: "Q" } },
				});
				const result = waiting.ImportBindings(save);
				expectArrayEqual(result.Applied, ["R6Adopt/Poke/KeyboardAndMouse"]);
				arrive();
				expectEqual(
					waiting.R6Adopt.Actions.Poke.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Q,
					"the imported key is still in effect after the swap",
				);
				expectEqual(waiting.ExportBindings(), save, "and exported the same");
			});

			test("after the swap, a handle that adopted the copy's binding has the first handle's defaults", () => {
				const { onCopy, waiting, arrive } = copyAndStandIn(LARGE_OTHER_KEY as unknown as typeof LARGE);
				arrive();
				const adopted = waiting.R6Adopt.Actions.Poke.Bindings.KeyboardAndMouse;
				expectEqual(
					adopted.Instance,
					onCopy.R6Adopt.Actions.Poke.Bindings.KeyboardAndMouse.Instance,
					"one binding for both handles",
				);
				expectEqual(waiting.ExportBindings(), EMPTY_SAVE, "nobody rebound anything");
				adopted.Reset();
				expectEqual(adopted.Instance.KeyCode, K.P, "Reset returns to the first handle's default");
				expectEqual(onCopy.ExportBindings(), EMPTY_SAVE, "the first handle sees no rebind");
			});

			test("after the swap, destroying the copy's handle leaves the adopted bindings working for the other", () => {
				const { onCopy, waiting, arrive } = copyAndStandIn(LARGE);
				arrive();
				const poke = waiting.R6Adopt.Actions.Poke;
				const binding = poke.Bindings.KeyboardAndMouse.Instance;
				onCopy.Destroy();
				expectTrue(binding.Parent !== undefined, "the adopted binding stays for the other handle");
				expectEqual(binding.KeyCode, K.P);
				poke.Fire(true);
				eventually(() => poke.IsPressed(), "Fire still works");
				poke.Fire(false);
				const stick = waiting.R6Adopt.Actions.Move;
				stick.Bindings.Virtual.Fire(new Vector2(1, 0));
				eventually(() => stick.GetState() === new Vector2(1, 0), "the adopted Scriptable slot fires");
				stick.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("buttons attached on the stand-in and on the copy under one name each keep a binding after the swap", () => {
				const { onCopy, waiting, arrive } = copyAndStandIn(LARGE);
				const gui = new Instance("ScreenGui");
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => gui.Destroy());
				const first = new Instance("TextButton");
				first.Parent = gui;
				const second = new Instance("TextButton");
				second.Parent = gui;
				onCopy.R6Adopt.Actions.Poke.AttachButton(first);
				const detach = waiting.R6Adopt.Actions.Poke.AttachButton(second);
				arrive();
				const action = waiting.R6Adopt.Actions.Poke.Instance;
				const buttons = action
					.GetChildren()
					.filter((child) => child.IsA("InputBinding") && child.UIButton !== undefined)
					.map((child) => child.Name);
				buttons.sort();
				expectArrayEqual(buttons, ["PokeUIButton1", "PokeUIButton2"]);
				detach();
				expectEqual(
					action.GetChildren().filter((child) => child.IsA("InputBinding") && child.UIButton === second)
						.size(),
					0,
					"the stand-in handle's detach removes its own button binding",
				);
				expectTrue(action.FindFirstChild("PokeUIButton1") !== undefined, "the other's stays");
			});

			// ---- the same situations without the adoption, as controls

			test("control: Create twice on one stand-in, the second's press stays after the first's Destroy", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(LARGE, options);
				defer(() => first.Destroy());
				const second = InputActions.Create(LARGE, options);
				defer(() => second.Destroy());
				first.R6Adopt.Actions.Poke.Fire(true);
				second.R6Adopt.Actions.Poke.Fire(true);
				localCopy(folderName, "R6Adopt", [
					["Poke", Enum.InputActionType.Bool],
					["Move", Enum.InputActionType.Direction2D],
					["Extra", Enum.InputActionType.Bool],
				]);
				eventually(() => second.R6Adopt.IsLinkedToServer(), "the swap");
				eventually(() => second.R6Adopt.Actions.Poke.IsPressed(), "held on the copy");
				first.Destroy();
				frames(3);
				expectTrue(second.R6Adopt.Actions.Poke.IsPressed(), "the second handle still holds it");
				second.R6Adopt.Actions.Poke.Fire(false);
			});

			test("control: a stand-in rebind carries over when no other handle is on the copy", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const input = InputActions.Create(LARGE, options);
				defer(() => input.Destroy());
				input.R6Adopt.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.Q);
				const saved = input.ExportBindings();
				localCopy(folderName, "R6Adopt", [
					["Poke", Enum.InputActionType.Bool],
					["Move", Enum.InputActionType.Direction2D],
					["Extra", Enum.InputActionType.Bool],
				]);
				eventually(() => input.R6Adopt.IsLinkedToServer(), "the swap");
				expectEqual(input.ExportBindings(), saved);
			});

			// ---- focus loss across the swap (spec sections 5 and 8)

			test("a focus-loss hold that spans the swap: one false/true pair, and the copy ends enabled", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const input = InputActions.Create(LARGE, options);
				defer(() => input.Destroy());
				const heard = recordSignal(input.R6Adopt.EnabledChanged);
				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				const copy = localCopy(folderName, "R6Adopt", [
					["Poke", Enum.InputActionType.Bool],
					["Move", Enum.InputActionType.Direction2D],
				]);
				box.CaptureFocus();
				addAction(copy, "Extra", Enum.InputActionType.Bool);
				eventually(() => input.R6Adopt.IsLinkedToServer(), "the swap");
				frames(3);
				expectTrue(input.R6Adopt.IsEnabled());
				expectTrue(copy.Enabled, "the copy is enabled once the hold ends");
				expectArrayEqual(heard, [false, true]);
			});

			// ---- AttachButton (spec section 6: a button destroyed before the call gets no binding; a
			// live one does, parented or not)

			test("AttachButton on a live button not parented yet, named with 'locked' in it, gets its binding", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				for (const name of ["UnlockedDoor", "LockedButton", "TextButton"]) {
					const button = new Instance("TextButton");
					button.Name = name;
					defer(() => button.Destroy());
					const [, message] = pcall(() => {
						button.Parent = button;
					});
					const detach = jump.AttachButton(button);
					const bindings = jump.Instance.GetChildren().filter(
						(child) => child.IsA("InputBinding") && child.UIButton === button,
					);
					expectEqual(
						bindings.size(),
						1,
						`a live button named ${name} gets one binding (its own-parent error: ${message})`,
					);
					detach();
				}
			});

			// ---- rebinding edges (spec section 6)

			test("Clear(slot) on a slot that is already None changes nothing and exports nothing", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Clear("PrimaryModifier");
				expectEqual(jump.Instance.KeyCode, K.Space);
				expectEqual(input.ExportBindings(), EMPTY_SAVE);
			});

			test("Set a KeyCode on a composite Direction1D binding, then a save round trip, then Reset", () => {
				const input = createTestInput();
				const zoom = input.Gameplay.Actions.Zoom.Bindings.Gamepad;
				zoom.Set(K.ButtonR2);
				expectEqual(zoom.Instance.KeyCode, K.ButtonR2);
				expectEqual(zoom.Instance.Up, K.None, "the composites are cleared");
				const json = input.ExportBindings();
				zoom.Reset();
				const result = input.ImportBindings(json);
				expectArrayEqual(
					result.Skipped.map((skipped) => `${skipped.Path}: ${skipped.Reason}`),
					[],
					json,
				);
				expectEqual(zoom.Instance.KeyCode, K.ButtonR2);
				expectEqual(zoom.Instance.Up, K.None);
				zoom.Reset();
				expectEqual(zoom.Instance.Up, K.DPadUp);
				expectEqual(zoom.Instance.KeyCode, K.None);
			});

			test("a context handle's import leaves the other contexts' rebinds alone", () => {
				const input = createTestInput();
				const open = input.Menu.Actions.Open.Bindings.KeyboardAndMouse;
				open.Set(K.N);
				const result = input.Gameplay.ImportBindings(
					HttpService.JSONEncode({
						Version: 1,
						Bindings: { "Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F" } },
					}),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Jump/KeyboardAndMouse"]);
				expectEqual(open.Instance.KeyCode, K.N, "Menu's rebind stays");
				expectEqual(input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.F);
			});

			test("Fire on one handle after the other root handle on the folder was destroyed", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				first.Gameplay.Actions.Dash.Fire(true);
				first.Destroy();
				frame();
				expectFalse(second.Gameplay.Actions.Dash.IsPressed(), "the first's press went with it");
				second.Gameplay.Actions.Dash.Fire(true);
				expectTrue(second.Gameplay.Actions.Dash.IsPressed());
				second.Gameplay.Actions.Dash.Fire(false);
			});
		});
	}
}
