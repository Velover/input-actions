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
import { createTestInput, frames, newFolder, recordSignal, recordWarnings } from "./helpers";

const K = Enum.KeyCode;

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
		});
	}
}
