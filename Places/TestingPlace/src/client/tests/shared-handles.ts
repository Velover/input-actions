import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectDefined,
	expectEqual,
	expectFalse,
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

const K = Enum.KeyCode;
const BOOL = Enum.InputActionType.Bool;

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function decode(json: string) {
	return HttpService.JSONDecode(json) as ISave;
}

function bindingsOf(action: Instance) {
	return action.GetChildren().filter((child) => child.IsA("InputBinding"));
}

function newButton() {
	const gui = new Instance("ScreenGui");
	gui.Name = "SharedHandlesButtons";
	gui.ResetOnSpawn = false;
	const button = new Instance("TextButton");
	button.Parent = gui;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => gui.Destroy());
	return button;
}

/** A folder with a designer's Gameplay.Jump and its `JumpKeyboardAndMouse` binding on F */
function designerFolder() {
	const folder = newFolder();
	const context = new Instance("InputContext");
	context.Name = "Gameplay";
	const jump = new Instance("InputAction");
	jump.Name = "Jump";
	jump.Parent = context;
	const keys = new Instance("InputBinding");
	keys.Name = "JumpKeyboardAndMouse";
	keys.KeyCode = K.F;
	keys.Parent = jump;
	context.Parent = folder;
	return { Folder: folder, Jump: jump, Keys: keys };
}

let folderCount = 0;
/** A player folder name no server provides: the tests play the server's copy on the client */
function uniqueFolderName() {
	folderCount++;
	return `SharedHandlesCopy${folderCount}`;
}

/** The arrival of the server's copy, played on the client: parented last, as ProvideToPlayers does */
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

const STAND_IN_SCHEMA = InputActions.Schema({
	SharedStandIn: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
			Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }, { TrackPrevious: true }),
		},
	},
});

/** The server's copy of `STAND_IN_SCHEMA`'s context, played on the client */
function standInCopy(folderName: string) {
	return localCopy(folderName, "SharedStandIn", [
		["Poke", Enum.InputActionType.Bool],
		["Move", Enum.InputActionType.Direction2D],
		["Crouch", Enum.InputActionType.Bool],
	]);
}

/** `STAND_IN_SCHEMA`'s context with Poke alone: a copy with only Poke already satisfies it */
const POKE_ONLY_SCHEMA = InputActions.Schema({
	SharedStandIn: {
		ServerAuthority: true,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
	},
});

/** Two root handles on one Server Authority schema, both made before the server's copy */
function twoHandlesOnStandIn(options?: InputActions.CreateOptions) {
	const folderName = options?.PlayerFolderName ?? uniqueFolderName();
	options ??= { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
	const first = InputActions.Create(STAND_IN_SCHEMA, options);
	defer(() => first.Destroy());
	const second = InputActions.Create(STAND_IN_SCHEMA, options);
	defer(() => second.Destroy());
	/** Plays the copy's arrival and waits for the live handles to swap */
	const arrive = () => {
		const copy = standInCopy(folderName);
		eventually(() => copy.FindFirstChild("Poke")!.GetChildren().size() > 0, "the swap");
		return copy;
	};
	return { First: first, Second: second, Arrive: arrive };
}

/** Several root handles on one folder share its instances (design spec §4) */
@Provider({ activeIn: ["testing"] })
export class SharedHandlesTests implements OnStart {
	onStart() {
		defineTests("shared-handles", () => {
			test("Create twice: destroying the first leaves what the second uses", () => {
				const folder = newFolder();
				const first = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => first.Destroy());
				const second = createTestInput(folder);
				const gameplay = first.Gameplay.Instance;
				const jumpKeys = first.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance;
				const dash = first.Gameplay.Actions.Dash;
				dash.Fire(true);
				const dashScript = expectDefined(dash.Instance.FindFirstChild("DashScript"));
				second.Gameplay.Actions.Dash.Fire(false); // adopts the first's binding

				first.Destroy();
				expectEqual(gameplay.Parent, folder);
				expectEqual(jumpKeys.Parent, second.Gameplay.Actions.Jump.Instance);
				expectEqual(dashScript.Parent, second.Gameplay.Actions.Dash.Instance);
				const jump = second.Gameplay.Actions.Jump;
				jump.Fire(true);
				expectTrue(jump.GetState());
				jump.Fire(false);

				second.Destroy();
				expectEqual(gameplay.Parent, undefined);
				expectEqual(jumpKeys.Parent, undefined);
				expectEqual(dashScript.Parent, undefined);
			});

			test("Create twice: one enabled state per context, whichever handle changes it", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => second.Destroy());
				const firstChanges = recordSignal(first.Gameplay.EnabledChanged);

				const release = first.Gameplay.Request(false);
				expectFalse(second.Gameplay.IsEnabled());
				second.Gameplay.SetEnabled(true);
				expectFalse(first.Gameplay.Instance.Enabled, "the request still wins");
				const hold = second.Menu.Request(true);
				expectTrue(first.Menu.IsEnabled());
				expectTrue(first.Menu.Instance.Enabled);
				// the second handle's requests end with it; the first's stay
				second.Destroy();
				hold();
				expectFalse(first.Menu.IsEnabled());
				expectFalse(first.Menu.Instance.Enabled);
				expectFalse(first.Gameplay.Instance.Enabled);
				release();
				expectTrue(first.Gameplay.IsEnabled());
				expectTrue(first.Gameplay.Instance.Enabled);
				eventually(() => firstChanges.size() === 2, "two changes");
				expectArrayEqual(firstChanges, [false, true]);
			});

			test("Create twice: the second handle has the same defaults", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				first.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.F);
				const second = createTestInput(folder);
				const keys = second.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance.KeyCode, K.F);
				expectEqual(
					decode(second.ExportBindings()).Bindings["Gameplay/Jump/KeyboardAndMouse"]?.KeyCode,
					"F",
				);
				keys.Reset();
				expectEqual(keys.Instance.KeyCode, K.Space);
			});

			test("Destroy gives adopted bindings their defaults back; Create again starts from them", () => {
				const { Folder: folder, Keys: keys } = designerFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Set({
					KeyCode: K.G,
					PrimaryModifier: K.LeftShift,
				});
				const save = input.ExportBindings();
				input.Destroy();
				expectEqual(keys.KeyCode, K.F);
				expectEqual(keys.PrimaryModifier, K.None);

				const again = createTestInput(folder);
				const binding = again.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				expectEqual(binding.Instance, keys);
				expectDefined(again.ImportBindings(save).Applied[0]);
				expectEqual(keys.KeyCode, K.G);
				expectEqual(again.ExportBindings(), save);
				binding.Reset();
				expectEqual(keys.KeyCode, K.F);
			});

			test("Destroy then Create again on the same folder", () => {
				const folder = newFolder();
				const first = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				first.Gameplay.Actions.Jump.Fire(true);
				first.Gameplay.Actions.Jump.AttachButton(newButton());
				first.Destroy();
				expectEqual(folder.GetChildren().size(), 0);

				const second = createTestInput(folder);
				const jump = second.Gameplay.Actions.Jump;
				expectFalse(jump.GetState());
				jump.Fire(true);
				expectTrue(jump.GetState());
				jump.Fire(false);
				expectEqual(bindingsOf(jump.Instance).size(), 3, "two slots and JumpScript");
			});

			test("after Destroy the handles change nothing and leave nothing behind", () => {
				const { Folder: folder, Jump: jumpInstance, Keys: keys } = designerFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				const gameplay = input.Gameplay;
				const jump = gameplay.Actions.Jump;
				const binding = jump.Bindings.KeyboardAndMouse;
				const save = decode(input.ExportBindings());
				save.Bindings["Gameplay/Jump/KeyboardAndMouse"] = { KeyCode: "G" };
				input.Destroy();

				jump.Fire(true);
				jump.Tap();
				jump.AttachButton(newButton())();
				jump.SetEnabled(false);
				binding.Set(K.H);
				binding.Clear();
				binding.Reset();
				binding.Capture("KeyCode", () => {})();
				expectEqual(input.ImportBindings(HttpService.JSONEncode(save)).Applied.size(), 0);
				input.ResetBindings();
				gameplay.SetEnabled(false);
				gameplay.Request(false)();
				frames(3);
				expectEqual(bindingsOf(jumpInstance).size(), 1, "only the designer's binding");
				expectEqual(keys.KeyCode, K.F);
				expectTrue(jumpInstance.Enabled);
				expectFalse(jumpInstance.GetState() as boolean);
				expectTrue(gameplay.Instance.Enabled);
			});

			test("attaching and removing buttons many times leaves no binding behind", () => {
				const folder = newFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				const jump = input.Gameplay.Actions.Jump;
				const button = newButton();
				for (let index = 0; index < 20; index++) jump.AttachButton(button)();
				const detach = jump.AttachButton(button);
				expectDefined(jump.Instance.FindFirstChild("JumpUIButton1"));
				detach();
				expectEqual(bindingsOf(jump.Instance).size(), 2, "the two slots");
				input.Destroy();
				// the button outlives the handle: destroying it now must not touch anything
				button.Destroy();
				frames(2);
			});

			test("Create twice before the server's copy: one set of bindings on the copy", () => {
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					SharedCopy: {
						ServerAuthority: true,
						Actions: {
							Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
							Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
						},
					},
				});
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(schema, options);
				defer(() => first.Destroy());
				const second = InputActions.Create(schema, options);
				defer(() => second.Destroy());
				first.SharedCopy.Actions.Poke.AttachButton(newButton());
				second.SharedCopy.Actions.Poke.AttachButton(newButton());
				second.SharedCopy.Actions.Move.Bindings.Virtual.Fire(new Vector2(1, 0));

				const copy = localCopy(folderName, "SharedCopy", [
					["Poke", Enum.InputActionType.Bool],
					["Move", Enum.InputActionType.Direction2D],
				]);
				eventually(
					() => first.SharedCopy.IsLinkedToServer() && second.SharedCopy.IsLinkedToServer(),
					"both links",
				);
				expectEqual(first.SharedCopy.Instance, copy);
				expectEqual(second.SharedCopy.Instance, copy);
				const poke = copy.FindFirstChild("Poke")!;
				const names = bindingsOf(poke).map((binding) => binding.Name);
				names.sort();
				expectArrayEqual(names, ["PokeKeyboardAndMouse", "PokeUIButton1", "PokeUIButton2"]);
				const keys = second.SharedCopy.Actions.Poke.Bindings.KeyboardAndMouse;
				expectEqual(keys.Instance, first.SharedCopy.Actions.Poke.Bindings.KeyboardAndMouse.Instance);
				expectEqual(bindingsOf(copy.FindFirstChild("Move")!).size(), 1, "one MoveVirtual");
				const move = second.SharedCopy.Actions.Move;
				eventually(() => move.GetState() === new Vector2(1, 0), "the held stick carried over");

				first.Destroy();
				expectEqual(keys.Instance.Parent, poke, "the second handle's binding stays");
				keys.Set(K.O);
				expectEqual(keys.Instance.KeyCode, K.O);
				move.Bindings.Virtual.Fire(Vector2.zero);
				eventually(() => move.GetState() === Vector2.zero, "the stick at rest");
				second.Destroy();
				expectEqual(bindingsOf(poke).size(), 0);
			});

			test("a second Create that throws leaves nothing in the first's shared state", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const wrong = InputActions.Schema({
					Gameplay: { Actions: { Jump: InputActions.Direction1D() } },
				});
				expectThrows(() => InputActions.Create(wrong, { Folder: folder }));
				const state = (
					first.Gameplay as unknown as { GetSharedState(): { Handles: unknown[] } }
				).GetSharedState();
				expectEqual(state.Handles.size(), 1, "handles on Gameplay's state");
				const jump = first.Gameplay.Actions.Jump;
				expectEqual(bindingsOf(jump.Instance).size(), 2, "Jump's two slots");
				jump.Fire(true);
				expectTrue(jump.GetState());
				jump.Fire(false);
			});

			test("two schemas on one folder don't warn about each other's contexts", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const first = InputActions.Schema({ SharedFirst: { Actions: { Poke: InputActions.Bool() } } });
				const second = InputActions.Schema({ SharedSecond: { Actions: { Poke: InputActions.Bool() } } });
				const firstInput = InputActions.Create(first, { Folder: folder });
				defer(() => firstInput.Destroy());
				const secondInput = InputActions.Create(second, { Folder: folder });
				defer(() => secondInput.Destroy());
				frames(3);
				const about = warnings.filter(
					(message) => message.find("SharedFirst", 1, true)[0] !== undefined,
				);
				expectArrayEqual(about, []);
			});

			test("Create twice before the copy: the template stays off until the last Destroy", () => {
				const folder = newFolder();
				const template = new Instance("InputContext");
				template.Name = "SharedTemplate";
				const poke = new Instance("InputAction");
				poke.Name = "Poke";
				poke.Parent = template;
				template.Parent = folder;
				const schema = InputActions.Schema({
					SharedTemplate: {
						ServerAuthority: true,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
					},
				});
				const options = { Folder: folder, PlayerFolderName: uniqueFolderName(), Timeout: 1000 };
				const first = InputActions.Create(schema, options);
				const second = InputActions.Create(schema, options);
				expectTrue(second.SharedTemplate.IsEnabled(), "the stand-in starts as the template");
				expectFalse(template.Enabled);
				second.Destroy();
				expectFalse(template.Enabled, "still off while the first lives");
				first.Destroy();
				expectTrue(template.Enabled);
			});

			// ---- what Destroy lets go of on an action another handle still uses

			test("Destroy on a shared action leaves a value another handle fired after it", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				holder.Gameplay.Actions.Move.Fire(new Vector2(0, 1));
				keeper.Gameplay.Actions.Move.Bindings.Virtual.Fire(new Vector2(1, 0));
				holder.Destroy();
				frames(3);
				expectEqual(keeper.Gameplay.Actions.Move.GetState(), new Vector2(1, 0), "the keeper's stick");
				expectEqual(
					holder.Gameplay.Actions.Move.Instance.FindFirstChild("MoveScript"),
					undefined,
					"the holder's own binding is gone",
				);
			});

			test("Destroy on a shared action leaves the other handle's hold on the same binding", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				holder.Gameplay.Actions.Look.Fire(new Vector2(3, 4));
				keeper.Gameplay.Actions.Look.Fire(new Vector2(1, 1)); // adopts the holder's LookScript
				holder.Destroy();
				frames(3);
				const look = keeper.Gameplay.Actions.Look;
				expectEqual(look.GetState(), new Vector2(1, 1));
				look.Fire(Vector2.zero);
				expectEqual(look.GetState(), Vector2.zero, "the keeper still lets go through it");
			});

			test("a Tap in flight when its handle is destroyed leaves the shared action at rest", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				const released = countSignal(keeper.Gameplay.Actions.Jump.Released);
				holder.Gameplay.Actions.Jump.Tap();
				holder.Destroy();
				expectFalse(keeper.Gameplay.Actions.Jump.IsPressed());
				frames(5);
				expectFalse(keeper.Gameplay.Actions.Jump.IsPressed());
				eventually(() => released.count === 1, "one Released");
			});

			test("a destroyed handle's buttons leave a press another handle fired", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				holder.Gameplay.Actions.Jump.AttachButton(newButton());
				keeper.Gameplay.Actions.Jump.Fire(true);
				holder.Destroy();
				frames(3);
				const jump = keeper.Gameplay.Actions.Jump;
				expectEqual(jump.Instance.FindFirstChild("JumpUIButton1"), undefined, "the button's binding");
				expectTrue(jump.IsPressed(), "the keeper's press");
				jump.Fire(false);
				expectFalse(jump.IsPressed());
			});

			test("a destroyed handle's button that may hold a shared action releases it", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				const jump = keeper.Gameplay.Actions.Jump;
				holder.Gameplay.Actions.Jump.AttachButton(newButton());
				// A binding the package doesn't drive stands in for the pressed button
				const press = new Instance("InputBinding");
				press.Name = "PressedButtonStandIn";
				press.Type = Enum.InputBindingType.Scriptable;
				press.Parent = jump.Instance;
				defer(() => press.Destroy());
				press.Fire(true);
				expectTrue(jump.IsPressed());
				holder.Destroy();
				frames(3);
				expectFalse(jump.IsPressed(), "released with the button's binding");
			});

			// ---- root handles on one stand-in before the server's copy arrives (§4, §8)

			test("Create twice before the copy: one stand-in, and both handles' requests carry over", () => {
				const { First: first, Second: second, Arrive: arrive } = twoHandlesOnStandIn();
				expectEqual(second.SharedStandIn.Instance, first.SharedStandIn.Instance, "one stand-in");
				expectEqual(
					second.SharedStandIn.Actions.Poke.Bindings.KeyboardAndMouse.Instance,
					first.SharedStandIn.Actions.Poke.Bindings.KeyboardAndMouse.Instance,
					"one binding",
				);
				const firstOff = first.SharedStandIn.Request(false);
				second.SharedStandIn.Request(true);
				expectFalse(second.SharedStandIn.IsEnabled());
				const copy = arrive();
				expectFalse(copy.Enabled, "the first handle's Request(false) holds the copy off");
				firstOff();
				expectTrue(copy.Enabled, "the second handle's Request(true)");
				second.SharedStandIn.SetEnabled(false);
				expectTrue(first.SharedStandIn.IsEnabled(), "Request(true) still wins over the base state");
				second.Destroy();
				expectFalse(first.SharedStandIn.IsEnabled(), "the second handle's request ended with it");
				expectFalse(copy.Enabled);
			});

			test("Create twice before the copy: the first handle destroyed, the second keeps the stand-in", () => {
				const { First: first, Second: second, Arrive: arrive } = twoHandlesOnStandIn();
				const standIn = second.SharedStandIn.Instance;
				const poke = second.SharedStandIn.Actions.Poke;
				const keys = poke.Bindings.KeyboardAndMouse.Instance;
				first.Destroy();
				expectTrue(standIn.Parent !== undefined, "the stand-in stays while the second handle uses it");
				expectEqual(keys.Parent, poke.Instance, "and so does its binding");
				poke.Fire(true);
				expectTrue(poke.GetState());
				poke.Fire(false);
				const copy = arrive();
				expectEqual(second.SharedStandIn.Instance, copy);
				expectEqual(keys.Parent, copy.FindFirstChild("Poke"), "the binding moved to the copy");
				expectEqual(standIn.Parent, undefined, "the stand-in is gone");
			});

			test("a second Create after the copy arrived swaps the waiting stand-in first", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(STAND_IN_SCHEMA, options);
				defer(() => first.Destroy());
				first.SharedStandIn.SetEnabled(false);
				// no frame between the copy and the Create: the first handle's watcher has not run
				const copy = standInCopy(folderName);
				const second = InputActions.Create(STAND_IN_SCHEMA, options);
				defer(() => second.Destroy());
				expectTrue(first.SharedStandIn.IsLinkedToServer(), "the first handle swapped");
				expectEqual(first.SharedStandIn.Instance, copy);
				expectFalse(copy.Enabled, "the base state the first handle set");
				expectFalse(second.SharedStandIn.IsEnabled());
				expectEqual(
					second.SharedStandIn.Actions.Poke.Bindings.KeyboardAndMouse.Instance,
					first.SharedStandIn.Actions.Poke.Bindings.KeyboardAndMouse.Instance,
				);
			});

			test("handles joining the state of one on the copy hear only their own change, never a passing value", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const copy = localCopy(folderName, "SharedStandIn", [["Poke", BOOL]]);
				const onCopy = InputActions.Create(POKE_ONLY_SCHEMA, options);
				defer(() => onCopy.Destroy());
				const { First: first, Second: second } = twoHandlesOnStandIn(options);
				expectFalse(first.SharedStandIn.IsLinkedToServer(), "the copy lacks Move and Crouch");
				// The stand-in is off: the second handle's Request(false) wins over the first's true one
				defer(first.SharedStandIn.Request(true));
				defer(second.SharedStandIn.Request(false));
				frames(1);
				const heardOnCopy = recordSignal(onCopy.SharedStandIn.EnabledChanged);
				const heardFirst = recordSignal(first.SharedStandIn.EnabledChanged);
				const heardSecond = recordSignal(second.SharedStandIn.EnabledChanged);
				const move = new Instance("InputAction");
				move.Name = "Move";
				move.Type = Enum.InputActionType.Direction2D;
				move.Parent = copy;
				const crouch = new Instance("InputAction");
				crouch.Name = "Crouch";
				crouch.Type = BOOL;
				crouch.Parent = copy;
				eventually(() => second.SharedStandIn.IsLinkedToServer(), "the swap");
				expectTrue(first.SharedStandIn.IsLinkedToServer(), "one swap for both");
				frames(2);
				expectFalse(copy.Enabled, "the Request(false) holds the copy off");
				expectArrayEqual(heardOnCopy, [false], "the copy's handle went from on to off");
				expectArrayEqual(heardFirst, [], "the first joining handle was off and stays off");
				expectArrayEqual(heardSecond, [], "the second joining handle was off and stays off");
			});

			test("the swap fires the held values again in the order they were fired", () => {
				const folderName = uniqueFolderName();
				const input = InputActions.Create(STAND_IN_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const move = input.SharedStandIn.Actions.Move;
				move.Fire(new Vector2(0, 1)); // MoveScript, made after MoveVirtual
				move.Bindings.Virtual.Fire(new Vector2(1, 0)); // the last write, which the action shows
				expectEqual(move.GetState(), new Vector2(1, 0));
				standInCopy(folderName);
				eventually(() => input.SharedStandIn.IsLinkedToServer(), "the link");
				eventually(() => move.GetState() === new Vector2(1, 0), "the last write shows on the copy");
				frames(5);
				expectEqual(move.GetState(), new Vector2(1, 0));
				move.Fire(Vector2.zero);
				move.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("a value held across the swap: StateChanged never repeats, TrackPrevious sees the release", () => {
				const folderName = uniqueFolderName();
				const input = InputActions.Create(STAND_IN_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const { Move: move, Crouch: crouch } = input.SharedStandIn.Actions;
				const moves = recordSignal(move.StateChanged);
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				crouch.Fire(true);
				eventually(() => crouch.IsJustPressed(), "the stand-in's press");
				eventually(() => !crouch.IsJustPressed() && moves.size() === 1, "the stand-in's events");
				standInCopy(folderName);
				const seen = new Array<string>();
				for (let index = 0; index < 30; index++) {
					frames(1);
					if (crouch.IsJustReleased()) seen.push("Released");
					if (crouch.IsJustPressed()) seen.push("Pressed");
				}
				expectTrue(input.SharedStandIn.IsLinkedToServer(), "the link");
				expectTrue(crouch.IsPressed(), "Crouch held on the copy");
				expectEqual(seen.join(","), "Released,Pressed", "IsJustReleased/IsJustPressed frames");
				expectEqual(move.GetState(), new Vector2(0, 1));
				for (let index = 1; index < moves.size(); index++) {
					expectTrue(moves[index] !== moves[index - 1], `StateChanged repeated ${moves[index]}`);
				}
				expectEqual(moves[moves.size() - 1], new Vector2(0, 1));
				crouch.Fire(false);
				move.Bindings.Virtual.Fire(Vector2.zero);
			});
		});
	}
}
