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
import { countSignal, createTestInput, frame, frames, newFolder, recordSignal } from "./helpers";

// Validator round 5: adversarial client tests (Fire around a disabled context or action, rebinding
// edges, saves).

const K = Enum.KeyCode;

function save(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function describeSkipped(result: InputActions.ImportResult) {
	return result.Skipped.map((skipped) => `${skipped.Path}: ${skipped.Reason}`);
}

/** Calls Set past the types, to reach the runtime checks */
function untypedSet(handle: object, spec: unknown) {
	(handle as { Set(spec: unknown): void }).Set(spec);
}

let folderCount = 0;
/** A player folder name no server provides: the tests play the server's copy on the client */
function uniqueFolderName() {
	folderCount++;
	return `ValidatorR5Copy${folderCount}`;
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

const JOIN_SMALL = InputActions.Schema({
	R5Join: {
		ServerAuthority: true,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
	},
});
const JOIN_LARGE = InputActions.Schema({
	R5Join: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
			Extra: InputActions.Bool({ KeyboardAndMouse: K.X }),
		},
	},
});

const SHARED_STICK = InputActions.Schema({
	R5Stick: {
		ServerAuthority: true,
		Actions: { Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }) },
	},
});

@Provider({ activeIn: ["testing"] })
export class ValidatorR5ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r5", () => {
			// ---- Fire around a disabled context or action (spec sections 5 and 6: a Fire while
			// disabled is ignored; nothing says it spoils the next one)

			test("a Fire ignored while the context was disabled doesn't swallow the same Fire once it is enabled", () => {
				const input = createTestInput();
				const dash = input.Gameplay.Actions.Dash;
				input.Gameplay.SetEnabled(false);
				dash.Fire(true);
				expectFalse(dash.IsPressed(), "ignored while disabled");
				input.Gameplay.SetEnabled(true);
				frame();
				dash.Fire(true);
				expectTrue(dash.IsPressed(), "Fire(true) presses once the context is enabled again");
				dash.Fire(false);
			});

			test("the same through a Request(false) and its release", () => {
				const input = createTestInput();
				const dash = input.Gameplay.Actions.Dash;
				const release = input.Gameplay.Request(false);
				dash.Fire(true);
				release();
				frame();
				dash.Fire(true);
				expectTrue(dash.IsPressed(), "Fire(true) presses once the request is released");
				dash.Fire(false);
			});

			test("a Scriptable slot fired while its context was disabled takes the same value once enabled", () => {
				const input = createTestInput();
				const move = input.Gameplay.Actions.Move;
				input.Gameplay.SetEnabled(false);
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				input.Gameplay.SetEnabled(true);
				frame();
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				expectEqual(move.GetState(), new Vector2(0, 1), "the virtual stick reads (0, 1)");
				move.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("a Fire ignored while the action was disabled doesn't swallow the same Fire once enabled", () => {
				const input = createTestInput();
				const dash = input.Gameplay.Actions.Dash;
				dash.SetEnabled(false);
				dash.Fire(true);
				dash.SetEnabled(true);
				frame();
				dash.Fire(true);
				expectTrue(dash.IsPressed(), "Fire(true) presses once the action is enabled again");
				dash.Fire(false);
			});

			test("a value held before the context was disabled can be fired again once it is enabled", () => {
				const input = createTestInput();
				const move = input.Gameplay.Actions.Move;
				move.Bindings.Virtual.Fire(new Vector2(1, 0));
				expectEqual(move.GetState(), new Vector2(1, 0));
				input.Gameplay.SetEnabled(false);
				expectEqual(move.GetState(), Vector2.zero, "released by the disable");
				input.Gameplay.SetEnabled(true);
				frame();
				move.Bindings.Virtual.Fire(new Vector2(1, 0));
				expectEqual(move.GetState(), new Vector2(1, 0), "the stick held again");
				move.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("Tap while the context is disabled leaves Fire working after it is enabled", () => {
				const input = createTestInput();
				const dash = input.Gameplay.Actions.Dash;
				input.Gameplay.SetEnabled(false);
				dash.Tap();
				frames(2);
				input.Gameplay.SetEnabled(true);
				frame();
				dash.Tap();
				expectTrue(dash.IsPressed(), "the second Tap presses");
				frames(3);
				expectFalse(dash.IsPressed(), "and releases");
			});

			// ---- Server Authority, several root handles (spec sections 4 and 8), the copy played on
			// the client

			test("a handle on a stand-in joins the enabled state of one already on the copy; its request ends with it", () => {
				const folderName = uniqueFolderName();
				const copy = localCopy(folderName, "R5Join", [["Poke", Enum.InputActionType.Bool]]);
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const onCopy = InputActions.Create(JOIN_SMALL, options);
				defer(() => onCopy.Destroy());
				expectTrue(onCopy.R5Join.IsLinkedToServer());
				onCopy.R5Join.SetEnabled(false);
				const keepOn = onCopy.R5Join.Request(true);
				defer(keepOn);
				frame();
				const heard = recordSignal(onCopy.R5Join.EnabledChanged);

				const waiting = InputActions.Create(JOIN_LARGE, options);
				defer(() => waiting.Destroy());
				expectFalse(waiting.R5Join.IsLinkedToServer(), "the copy lacks Extra: a stand-in");
				const keepOff = waiting.R5Join.Request(false);
				defer(keepOff);

				addAction(copy, "Extra", Enum.InputActionType.Bool);
				eventually(() => waiting.R5Join.IsLinkedToServer(), "the swap");
				expectEqual(waiting.R5Join.Instance, copy);
				expectFalse(onCopy.R5Join.IsEnabled(), "one enabled state: the false request wins");
				expectFalse(waiting.R5Join.IsEnabled());
				expectFalse(copy.Enabled);

				waiting.Destroy();
				expectTrue(onCopy.R5Join.IsEnabled(), "the destroyed handle's request ended");
				expectTrue(copy.Enabled);
				keepOn();
				expectFalse(onCopy.R5Join.IsEnabled(), "back to the base state");
				expectFalse(copy.Enabled);
				frame();
				expectArrayEqual(heard, [false, true, false]);
			});

			test("joining the copy's state: the joining handle, off before and after, hears no EnabledChanged", () => {
				const folderName = uniqueFolderName();
				const copy = localCopy(folderName, "R5Join", [["Poke", Enum.InputActionType.Bool]]);
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const onCopy = InputActions.Create(JOIN_SMALL, options);
				defer(() => onCopy.Destroy());
				// the copy's state is on, held by a request
				const keepOn = onCopy.R5Join.Request(true);
				defer(keepOn);
				const waiting = InputActions.Create(JOIN_LARGE, options);
				defer(() => waiting.Destroy());
				// the stand-in's handle is off, held by a request that wins once joined
				const keepOff = waiting.R5Join.Request(false);
				defer(keepOff);
				frame();
				const heard = recordSignal(waiting.R5Join.EnabledChanged);
				const heardOnCopy = recordSignal(onCopy.R5Join.EnabledChanged);
				addAction(copy, "Extra", Enum.InputActionType.Bool);
				eventually(() => waiting.R5Join.IsLinkedToServer(), "the swap");
				frames(2);
				expectFalse(waiting.R5Join.IsEnabled());
				expectArrayEqual(heardOnCopy, [false], "the copy's handle went from on to off");
				expectArrayEqual(heard, [], "the joining handle was off and stays off");
			});

			test("joining the copy's state: a handle whose state doesn't change hears nothing", () => {
				const folderName = uniqueFolderName();
				const copy = localCopy(folderName, "R5Join", [["Poke", Enum.InputActionType.Bool]]);
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const onCopy = InputActions.Create(JOIN_SMALL, options);
				defer(() => onCopy.Destroy());
				onCopy.R5Join.SetEnabled(false);
				const waiting = InputActions.Create(JOIN_LARGE, options);
				defer(() => waiting.Destroy());
				waiting.R5Join.SetEnabled(false);
				const keepOff = waiting.R5Join.Request(false);
				defer(keepOff);
				frame();
				const heard = recordSignal(waiting.R5Join.EnabledChanged);
				const heardOnCopy = recordSignal(onCopy.R5Join.EnabledChanged);
				addAction(copy, "Extra", Enum.InputActionType.Bool);
				eventually(() => waiting.R5Join.IsLinkedToServer(), "the swap");
				frames(2);
				expectFalse(waiting.R5Join.IsEnabled());
				expectArrayEqual(heard, [], "the stand-in's handle was off and stays off");
				expectArrayEqual(heardOnCopy, [], "the copy's handle was off and stays off");
			});

			test("a value two handles fired on one Scriptable slot of a stand-in stays held across the swap and the first Destroy", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(SHARED_STICK, options);
				defer(() => first.Destroy());
				const second = InputActions.Create(SHARED_STICK, options);
				defer(() => second.Destroy());
				const value = new Vector2(0, 1);
				first.R5Stick.Actions.Move.Bindings.Virtual.Fire(value);
				second.R5Stick.Actions.Move.Bindings.Virtual.Fire(value);
				localCopy(folderName, "R5Stick", [["Move", Enum.InputActionType.Direction2D]]);
				eventually(() => second.R5Stick.IsLinkedToServer(), "the swap");
				eventually(() => second.R5Stick.Actions.Move.GetState() === value, "held on the copy");
				first.Destroy();
				frames(2);
				expectEqual(
					second.R5Stick.Actions.Move.GetState(),
					value,
					"the second handle still holds it",
				);
				second.R5Stick.Actions.Move.Bindings.Virtual.Fire(Vector2.zero);
				eventually(
					() => second.R5Stick.Actions.Move.GetState() === Vector2.zero,
					"released by its holder",
				);
			});

			test("Create with a Timeout of math.huge, 0 or -1 doesn't throw, and the stand-in works", () => {
				for (const timeout of [math.huge, 0, -1]) {
					const folderName = uniqueFolderName();
					const [ok, input] = pcall(() =>
						InputActions.Create(JOIN_SMALL, {
							Folder: newFolder(),
							PlayerFolderName: folderName,
							Timeout: timeout,
						}),
					);
					expectTrue(ok, `Timeout ${timeout}: Create threw ${input}`);
					if (!ok) continue;
					defer(() => input.Destroy());
					input.R5Join.Actions.Poke.Fire(true);
					expectTrue(
						input.R5Join.Actions.Poke.IsPressed(),
						`Timeout ${timeout}: the stand-in works`,
					);
					input.R5Join.Actions.Poke.Fire(false);
				}
			});

			// ---- rebinding edges (spec section 6)

			test("Set with a DisplayImage it can't apply throws before changing anything, or applies it all", () => {
				const input = createTestInput();
				const binding = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				const changed = recordSignal(input.BindingsChanged);
				for (const image of ["", "not a uri", "rbxassetid://"]) {
					const [ok, problem] = pcall(() => binding.Set({ KeyCode: K.F, DisplayImage: image }));
					if (ok) {
						expectEqual(binding.Instance.KeyCode, K.F, `"${image}": the key applied`);
					} else {
						expectEqual(
							binding.Instance.KeyCode,
							K.Space,
							`"${image}": Set threw (${problem}) after changing the key`,
						);
					}
					binding.Reset();
				}
				frame();
				expectTrue(changed.size() > 0);
			});

			test("Set, then Clear, then Set with an object: the object's key comes back, the rest stays cleared", () => {
				const input = createTestInput();
				const quickSave = input.Gameplay.Actions.QuickSave.Bindings.KeyboardAndMouse;
				quickSave.Clear();
				expectEqual(quickSave.Instance.PrimaryModifier, K.None, "Clear takes the modifier off");
				quickSave.Set({ KeyCode: K.S });
				expectEqual(quickSave.Instance.KeyCode, K.S);
				expectEqual(quickSave.Instance.PrimaryModifier, K.None, "the modifier stays off");
				const json = input.ExportBindings();
				const again = input.ImportBindings(json);
				expectArrayEqual(describeSkipped(again), [], json);
				expectEqual(quickSave.Instance.PrimaryModifier, K.None, `after re-importing ${json}`);
				quickSave.Reset();
				expectEqual(quickSave.Instance.PrimaryModifier, K.LeftControl, "Reset brings it back");
			});

			test("an entry that is an empty object applies nothing and leaves the binding at its default", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set(K.F);
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{}}}',
				);
				expectArrayEqual(describeSkipped(result), []);
				expectEqual(jump.Instance.KeyCode, K.Space, "reset to its default");
				expectEqual(input.ExportBindings(), '{"Version":1,"Bindings":{}}');
			});

			test("a save whose Bindings nest right at the limit still imports", () => {
				const input = createTestInput();
				const json = save({
					"Gameplay/Look/KeyboardAndMouse": { Vector2Scale: [2, -2] },
					"Gameplay/Fly/KeyboardAndMouse": { Vector3Scale: [1, 2, 3] },
				});
				const result = input.ImportBindings(json);
				expectArrayEqual(describeSkipped(result), [], json);
				expectEqual(result.Applied.size(), 2);
				const inString = save({
					"Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F" },
					[`${string.rep("[", 50)}`]: { KeyCode: "G" },
				});
				const withBrackets = input.ImportBindings(inString);
				expectArrayEqual(withBrackets.Applied, ["Gameplay/Jump/KeyboardAndMouse"], inString);
			});

			// ---- Create twice: rebinding through one root handle (spec section 4: every handle on a
			// binding has the same defaults)

			test("Reset through a second root handle returns to the defaults the first one took", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				first.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.F);
				const second = createTestInput(folder);
				const jump = second.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(jump.Instance.KeyCode, K.F, "the second handle sees the rebind");
				jump.Reset();
				expectEqual(jump.Instance.KeyCode, K.Space, "the defaults are the first handle's");
				first.Destroy();
				expectEqual(jump.Instance.Parent !== undefined, true, "the binding stays for the second");
				expectEqual(second.ExportBindings(), '{"Version":1,"Bindings":{}}');
			});

			test("eventually: a handle's listeners hear a press fired right after Create", () => {
				const input = createTestInput();
				const presses = countSignal(input.Gameplay.Actions.Dash.Pressed);
				input.Gameplay.Actions.Dash.Fire(true);
				eventually(() => presses.count === 1, "one Pressed");
				input.Gameplay.Actions.Dash.Fire(false);
			});
		});
	}
}
