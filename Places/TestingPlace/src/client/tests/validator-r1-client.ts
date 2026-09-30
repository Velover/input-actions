import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, Players } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import {
	countSignal,
	createTestInput,
	frames,
	newFolder,
	recordSignal,
	recordWarnings,
} from "./helpers";

// Validator round 1: adversarial client tests (edge cases, lifecycle, Server Authority swap).

const K = Enum.KeyCode;

function newButton() {
	const gui = new Instance("ScreenGui");
	gui.Name = "ValidatorR1Buttons";
	gui.ResetOnSpawn = false;
	const button = new Instance("TextButton");
	button.Size = UDim2.fromOffset(80, 80);
	button.Parent = gui;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => gui.Destroy());
	return button;
}

let folderCount = 0;
/** A player folder name no server ever provides, for tests that play the server's copy locally */
function uniqueFolderName() {
	folderCount++;
	return `ValidatorR1Copy${folderCount}`;
}

/**
 * Plays the arrival of the server's copy on the client alone: a client-only folder under
 * LocalPlayer holding the context and its actions, parented last as ProvideToPlayers does.
 */
function localCopy(
	folderName: string,
	contextName: string,
	actions: Array<[string, Enum.InputActionType]>,
): InputContext {
	const folder = new Instance("Folder");
	folder.Name = folderName;
	const context = new Instance("InputContext");
	context.Name = contextName;
	for (const [name, actionType] of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Type = actionType;
		action.Parent = context;
	}
	context.Parent = folder;
	folder.Parent = Players.LocalPlayer;
	defer(() => folder.Destroy());
	return context;
}

/** A template context shaped like the Input Action Manager's, in a client-only folder */
function localTemplate(contextName: string) {
	const folder = newFolder("ValidatorR1Templates");
	const context = new Instance("InputContext");
	context.Name = contextName;
	context.Enabled = true;
	const poke = new Instance("InputAction");
	poke.Name = "Poke";
	poke.Parent = context;
	const binding = new Instance("InputBinding");
	binding.Name = "PokeKeyboardAndMouse";
	binding.KeyCode = K.P;
	binding.Parent = poke;
	context.Parent = folder;
	return { Folder: folder, Template: context };
}

function mentions(messages: string[], text: string) {
	return messages.some((message) => message.find(text, 1, true)[0] !== undefined);
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR1ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r1", () => {
			// ---- Fire after the package (or IAS) released an action

			test("Fire(true) presses again after a context disable/enable", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				jump.Fire(true);
				frames(2);
				const release = input.Gameplay.Request(false);
				expectFalse(jump.GetState());
				release();
				frames(2);
				jump.Fire(true);
				expectTrue(jump.GetState(), "Fire(true) after the context came back");
				jump.Fire(false);
			});

			test("Fire(true) presses again after SetEnabled(false/true)", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Fire(true);
				frames(2);
				jump.SetEnabled(false);
				jump.SetEnabled(true);
				expectFalse(jump.GetState());
				jump.Fire(true);
				expectTrue(jump.GetState(), "Fire(true) after the action came back");
				jump.Fire(false);
			});

			test("Fire(true) presses again after a detached button reset the action", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Fire(true);
				frames(2);
				jump.AttachButton(newButton())();
				expectFalse(jump.GetState());
				jump.Fire(true);
				expectTrue(jump.GetState(), "Fire(true) after the held-binding reset");
				jump.Fire(false);
			});

			test("a Scriptable slot presses again after the focus-loss reset", () => {
				const input = createTestInput();
				const move = input.Gameplay.Actions.Move;
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				frames(2);
				const release = input.Gameplay.Request(false);
				expectEqual(move.GetState(), Vector2.zero);
				release();
				frames(2);
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				expectEqual(move.GetState(), new Vector2(0, 1), "the virtual stick held again");
				move.Bindings.Virtual.Fire(Vector2.zero);
			});

			// ---- lifecycle

			// (Destroying the FIRST of two handles destroys the instances the second adopted: spec
			// section 4 says Destroy removes what the package created, so that is left to the spec.)
			test("Create twice: destroying the second handle leaves the first's held input", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const move = first.Gameplay.Actions.Move;
				const jump = first.Gameplay.Actions.Jump;
				move.Bindings.Virtual.Fire(new Vector2(1, 0));
				jump.Fire(true);
				const second = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				second.Destroy();
				frames(2);
				expectEqual(move.GetState(), new Vector2(1, 0), "the first handle's virtual stick");
				expectTrue(jump.GetState(), "the first handle's held Jump");
				move.Bindings.Virtual.Fire(Vector2.zero);
				jump.Fire(false);
			});

			test("requests and base state calls after Destroy don't throw", () => {
				const input = InputActions.Create(TEST_SCHEMA, { Folder: newFolder() });
				const release = input.Gameplay.Request(false);
				const hold = input.Menu.Request(true);
				input.Destroy();
				expectNoThrow(release, "a release after Destroy");
				expectNoThrow(hold, "a release after Destroy");
				expectNoThrow(() => input.Gameplay.SetEnabled(false), "SetEnabled after Destroy");
			});

			test("a type mismatch in a later context removes everything Create made", () => {
				const folder = newFolder();
				const menu = new Instance("InputContext");
				menu.Name = "Menu";
				const open = new Instance("InputAction");
				open.Name = "Open";
				open.Type = Enum.InputActionType.Direction1D;
				open.Parent = menu;
				menu.Parent = folder;

				const message = expectThrows(() => InputActions.Create(TEST_SCHEMA, { Folder: folder }));
				expectTrue(message.find("Menu/Open", 1, true)[0] !== undefined, message);
				expectEqual(folder.GetChildren().size(), 1, "only the designer's Menu is left");
				expectEqual(menu.GetChildren().size(), 1, "Menu keeps only its own action");
				expectEqual(open.GetChildren().size(), 0, "nothing was added under the adopted action");
			});

			test("a context named like a runtime member works or is refused by Schema", () => {
				let schema: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;
				try {
					schema = InputActions.Schema({
						NotifyBindingChanged: {
							Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
						},
					}) as never;
				} catch {
					return; // refused by Schema: fine
				}
				const input = InputActions.Create(schema, { Folder: newFolder() }) as unknown as Record<
					string,
					{
						Actions: Record<string, { Bindings: Record<string, { Set(key: Enum.KeyCode): void }> }>;
					}
				> & { Destroy(): void };
				defer(() => input.Destroy());
				input.NotifyBindingChanged.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.O);
			});

			test("Destroy before the server's copy arrives: the copy is left untouched", () => {
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					VrEarly: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				input.Destroy();
				const copy = localCopy(folderName, "VrEarly", [["Poke", Enum.InputActionType.Bool]]);
				frames(5);
				expectEqual(copy.FindFirstChild("Poke")!.GetChildren().size(), 0);
			});

			// ---- Server Authority, with the server's copy played locally

			test("a server copy of another Type leaves the stand-in working", () => {
				const warnings = recordWarnings();
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					VrMismatch: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const context = input.VrMismatch;
				const poke = context.Actions.Poke;
				const standIn = context.Instance;
				const pressed = countSignal(poke.Pressed);

				localCopy(folderName, "VrMismatch", [["Poke", Enum.InputActionType.Direction1D]]);
				eventually(() => mentions(warnings, "VrMismatch/Poke"), "the mismatch warning");
				frames(3);
				expectFalse(context.IsLinkedToServer());
				expectEqual(context.Instance, standIn);
				expectTrue(standIn.Parent !== undefined, "the stand-in context is still in place");
				expectTrue(
					poke.Bindings.KeyboardAndMouse.Instance.Parent !== undefined,
					"the stand-in's binding is still in place",
				);
				poke.Fire(true);
				expectTrue(poke.GetState());
				eventually(() => pressed.count === 1, "Pressed still forwarded from the stand-in");
				poke.Fire(false);
			});

			test("the swap carries the base state, action Enabled and attached buttons", () => {
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					VrSwap: {
						ServerAuthority: true,
						Actions: {
							Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }),
							Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
						},
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				let destroyed = false;
				defer(() => {
					if (!destroyed) input.Destroy();
				});
				const context = input.VrSwap;
				const { Jump, Move } = context.Actions;
				const links = countSignal(context.LinkedToServer);
				const changes = recordSignal(context.EnabledChanged);
				context.SetEnabled(false);
				Jump.SetEnabled(false);
				const button = newButton();
				Jump.AttachButton(button);
				Move.Bindings.Virtual.Fire(new Vector2(1, 0));

				const copy = localCopy(folderName, "VrSwap", [
					["Jump", Enum.InputActionType.Bool],
					["Move", Enum.InputActionType.Direction2D],
				]);
				eventually(() => context.IsLinkedToServer(), "the link");
				expectEqual(context.Instance, copy);
				expectFalse(copy.Enabled, "the base state carried over");
				expectFalse(context.IsEnabled());
				expectFalse(Jump.Instance.Enabled, "the action's Enabled carried over");
				expectFalse(Jump.IsEnabled());
				const buttonBinding = Jump.Instance.FindFirstChild("JumpUIButton1") as
					InputBinding | undefined;
				expectTrue(
					buttonBinding !== undefined && buttonBinding.UIButton === button,
					"the attached button moved to the copy",
				);

				context.SetEnabled(true);
				Jump.SetEnabled(true);
				expectTrue(copy.Enabled);
				// under a Player, IAS updates the state on the next simulation step (Server Authority)
				Jump.Fire(true);
				eventually(() => Jump.GetState(), "Jump pressed on the copy");
				Jump.Fire(false);
				eventually(() => !Jump.GetState(), "Jump released on the copy");
				button.Destroy();
				eventually(
					() => Jump.Instance.FindFirstChild("JumpUIButton1") === undefined,
					"the destroyed button's binding removed from the copy",
				);
				frames(3);
				expectEqual(links.count, 1);
				expectEqual(changes[0], false);

				input.Destroy();
				destroyed = true;
				expectEqual(copy.FindFirstChild("Jump")!.GetChildren().size(), 0, "Jump's bindings gone");
				expectEqual(copy.FindFirstChild("Move")!.GetChildren().size(), 0, "Move's bindings gone");
				expectTrue(copy.Enabled, "the copy gets the base state back");
			});

			test("after the Timeout warning, a late copy still swaps", () => {
				const warnings = recordWarnings();
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					VrLate: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 0.2,
				});
				defer(() => input.Destroy());
				eventually(() => mentions(warnings, folderName), "the Timeout warning");
				const links = countSignal(input.VrLate.LinkedToServer);
				const copy = localCopy(folderName, "VrLate", [["Poke", Enum.InputActionType.Bool]]);
				eventually(() => input.VrLate.IsLinkedToServer(), "the late link");
				expectEqual(input.VrLate.Instance, copy);
				eventually(() => links.count === 1, "LinkedToServer once");
				frames(3);
				expectEqual(
					warnings.filter((message) => message.find(folderName, 1, true)[0] !== undefined).size(),
					1,
					"warnings naming the folder",
				);
			});

			test("Create twice before the copy: the second stand-in starts as the template", () => {
				const { Folder: folder } = localTemplate("VrTwiceStandIn");
				const schema = InputActions.Schema({
					VrTwiceStandIn: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const options = { Folder: folder, PlayerFolderName: uniqueFolderName(), Timeout: 1000 };
				const first = InputActions.Create(schema, options);
				defer(() => first.Destroy());
				const second = InputActions.Create(schema, options);
				defer(() => second.Destroy());
				expectTrue(first.VrTwiceStandIn.IsEnabled());
				expectTrue(
					second.VrTwiceStandIn.IsEnabled(),
					"the second handle's stand-in is enabled like the designer's template",
				);
			});

			test("Create twice with the copy there: the template stays off until the last Destroy", () => {
				const { Folder: folder, Template: template } = localTemplate("VrTwiceCopy");
				const folderName = uniqueFolderName();
				localCopy(folderName, "VrTwiceCopy", [["Poke", Enum.InputActionType.Bool]]);
				const schema = InputActions.Schema({
					VrTwiceCopy: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const options = { Folder: folder, PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(schema, options);
				const second = InputActions.Create(schema, options);
				expectFalse(template.Enabled);
				first.Destroy();
				const whileSecondLives = template.Enabled;
				second.Destroy();
				expectFalse(whileSecondLives, "the template stays off while the second handle lives");
				expectTrue(template.Enabled, "the template is back on once no handle is left");
			});

			test("a copy of another Type already there throws, and gives the template back", () => {
				const { Folder: folder, Template: template } = localTemplate("VrCopyMismatch");
				const folderName = uniqueFolderName();
				localCopy(folderName, "VrCopyMismatch", [["Poke", Enum.InputActionType.Direction2D]]);
				const schema = InputActions.Schema({
					VrCopyMismatch: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const message = expectThrows(() =>
					InputActions.Create(schema, { Folder: folder, PlayerFolderName: folderName }),
				);
				expectTrue(message.find("VrCopyMismatch/Poke", 1, true)[0] !== undefined, message);
				expectTrue(template.Enabled, "the template is enabled again");
			});

			// ---- saves

			test("import refuses a ResponseCurve on a binding that is not a thumbstick, as Set does", () => {
				const input = createTestInput();
				const look = input.Gameplay.Actions.Look.Bindings.Mouse;
				expectThrows(() =>
					(look as unknown as { Set(spec: unknown): void }).Set({
						KeyCode: K.MouseDelta,
						ResponseCurve: 2,
					}),
				);
				const result = input.ImportBindings(
					HttpService.JSONEncode({
						Version: 1,
						Bindings: { "Gameplay/Look/Mouse": { ResponseCurve: 2 } },
					}),
				);
				expectEqual(result.Applied.size(), 0, "applied entries");
				expectEqual(look.Instance.ResponseCurve, 1);
			});

			test("ExportBindings after a stand-in swap still holds the rebinds", () => {
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					VrSaves: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const input = InputActions.Create(schema, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				input.VrSaves.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.L);
				const before = input.ExportBindings();
				localCopy(folderName, "VrSaves", [["Poke", Enum.InputActionType.Bool]]);
				eventually(() => input.VrSaves.IsLinkedToServer(), "the link");
				expectEqual(input.ExportBindings(), before);
				input.ResetBindings();
				expectEqual(input.VrSaves.Actions.Poke.Bindings.KeyboardAndMouse.Instance.KeyCode, K.P);
				expectDefined(input.ImportBindings(before).Applied[0]);
				expectEqual(input.VrSaves.Actions.Poke.Bindings.KeyboardAndMouse.Instance.KeyCode, K.L);
			});
		});
	}
}
