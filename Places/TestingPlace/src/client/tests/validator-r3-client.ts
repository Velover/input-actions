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
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frames, newFolder, recordSignal } from "./helpers";

// Validator round 3: adversarial client tests (saves with numbers a binding can't hold, slot names
// that resolve to one binding, what Destroy lets go of on a shared action, stand-ins of several root
// handles, AttachButton edge cases, and a few round trips).

const K = Enum.KeyCode;

function save(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function describeSkipped(result: InputActions.ImportResult) {
	return result.Skipped.map((skipped) => `${skipped.Path}: ${skipped.Reason}`);
}

/**
 * What the design spec promises for saves (section 7): what an import applied exports again, and
 * that export imports cleanly ("every export imports cleanly").
 */
function expectExportRoundTrips(input: ReturnType<typeof createTestInput>, path: string) {
	const [ok, json] = pcall(() => input.ExportBindings());
	expectTrue(ok, `ExportBindings threw: ${json}`);
	const again = input.ImportBindings(json as string);
	expectArrayEqual(describeSkipped(again), [], `re-importing ${json}`);
	expectArrayEqual(again.Applied, [path], `re-importing ${json}`);
}

function bindingsOf(action: Instance) {
	return action.GetChildren().filter((child) => child.IsA("InputBinding"));
}

function newButton() {
	const gui = new Instance("ScreenGui");
	gui.Name = "ValidatorR3Buttons";
	gui.ResetOnSpawn = false;
	const button = new Instance("TextButton");
	button.Parent = gui;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => gui.Destroy());
	return button;
}

let folderCount = 0;
/** A player folder name no server provides: the tests play the server's copy on the client */
function uniqueFolderName() {
	folderCount++;
	return `ValidatorR3Copy${folderCount}`;
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
	R3StandIn: {
		ServerAuthority: true,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) },
	},
});

/** Two root handles on one Server Authority schema, both created before the server's copy */
function twoHandlesBeforeCopy() {
	const folderName = uniqueFolderName();
	const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
	const first = InputActions.Create(STAND_IN_SCHEMA, options);
	defer(() => first.Destroy());
	const second = InputActions.Create(STAND_IN_SCHEMA, options);
	defer(() => second.Destroy());
	const arrive = () => {
		const copy = localCopy(folderName, "R3StandIn", [["Poke", Enum.InputActionType.Bool]]);
		eventually(
			() => first.R3StandIn.IsLinkedToServer() && second.R3StandIn.IsLinkedToServer(),
			"both links",
		);
		return copy;
	};
	return { First: first, Second: second, Arrive: arrive };
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR3ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r3", () => {
			// ---- saves with numbers a float property can't hold (design spec section 7)

			test("an imported Scale beyond the float range still exports and imports cleanly", () => {
				const input = createTestInput();
				const result = input.ImportBindings(
					save({ "Gameplay/Look/KeyboardAndMouse": { Scale: 1e39 } }),
				);
				if (result.Applied.size() === 0) return; // skipped as not finite: fine
				expectExportRoundTrips(input, "Gameplay/Look/KeyboardAndMouse");
			});

			test("an imported Vector2Scale beyond the float range still exports and imports cleanly", () => {
				const input = createTestInput();
				const result = input.ImportBindings(
					save({ "Gameplay/Look/KeyboardAndMouse": { Vector2Scale: [1e39, 1] } }),
				);
				if (result.Applied.size() === 0) return; // skipped as not finite: fine
				expectExportRoundTrips(input, "Gameplay/Look/KeyboardAndMouse");
			});

			test("a PressedThreshold beyond the float range, cleaned by SanitizeBindings, imports and exports cleanly", () => {
				const input = createTestInput();
				// what a server would store after cleaning a client's save
				const clean = InputActions.SanitizeBindings(
					TEST_SCHEMA,
					save({ "Gameplay/Fire/Gamepad": { PressedThreshold: 1e39 } }),
				);
				const result = input.ImportBindings(clean);
				if (result.Applied.size() === 0) return; // dropped by SanitizeBindings or skipped: fine
				expectExportRoundTrips(input, "Gameplay/Fire/Gamepad");
			});

			test("Set with a Scale beyond the float range throws, or exports cleanly", () => {
				const input = createTestInput();
				const look = input.Gameplay.Actions.Look.Bindings.KeyboardAndMouse;
				const [ok] = pcall(() => look.Set({ KeyCode: K.MouseDelta, Scale: 1e39 }));
				if (!ok) return; // refused: fine
				expectExportRoundTrips(input, "Gameplay/Look/KeyboardAndMouse");
			});

			// ---- slot names: `S` and `<Action>S` on one action (design spec section 4)

			test("slots named S and <Action>S get a binding each, in a fresh folder and on a second Create", () => {
				let schema: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;
				try {
					schema = InputActions.Schema({
						R3Slots: {
							Actions: {
								Jump: InputActions.Bool({
									Gamepad: K.ButtonA,
									JumpGamepad: InputActions.Scriptable,
								}),
							},
						},
					}) as never;
				} catch {
					return; // refused by Schema: fine
				}
				type AnyHandle = Record<
					string,
					{ Actions: Record<string, { Bindings: Record<string, { Instance: InputBinding }> }> }
				> & { Destroy(): void };
				const folder = newFolder();
				const first = InputActions.Create(schema, { Folder: folder }) as unknown as AnyHandle;
				defer(() => first.Destroy());
				const bindings = first.R3Slots.Actions.Jump.Bindings;
				expectTrue(
					bindings.Gamepad.Instance !== bindings.JumpGamepad.Instance,
					"one binding per slot",
				);
				expectEqual(bindings.Gamepad.Instance.KeyCode, K.ButtonA, "Gamepad's key");
				expectEqual(
					bindings.JumpGamepad.Instance.Type,
					Enum.InputBindingType.Scriptable,
					"JumpGamepad's type",
				);

				const second = InputActions.Create(schema, { Folder: folder }) as unknown as AnyHandle;
				defer(() => second.Destroy());
				const again = second.R3Slots.Actions.Jump.Bindings;
				expectEqual(
					again.Gamepad.Instance,
					bindings.Gamepad.Instance,
					"the second handle's Gamepad",
				);
				expectEqual(
					again.JumpGamepad.Instance,
					bindings.JumpGamepad.Instance,
					"the second handle's JumpGamepad",
				);
			});

			// ---- what Destroy lets go of on a shared action (design spec section 4)

			test("Destroy leaves another handle's stick fired after it, when both show the same value", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				holder.Gameplay.Actions.Move.Fire(new Vector2(0, 1)); // MoveScript
				// fired after it, on another binding: the action shows this one now
				keeper.Gameplay.Actions.Move.Bindings.Virtual.Fire(new Vector2(0, 1));
				holder.Destroy();
				frames(3);
				expectEqual(
					keeper.Gameplay.Actions.Move.GetState(),
					new Vector2(0, 1),
					"the keeper's virtual stick, still held",
				);
				keeper.Gameplay.Actions.Move.Bindings.Virtual.Fire(Vector2.zero);
			});

			test("Destroy leaves a press the other handle fired first on the same binding", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				defer(() => holder.Destroy());
				const jump = keeper.Gameplay.Actions.Jump;
				jump.Fire(true); // the keeper holds Jump through JumpScript
				holder.Gameplay.Actions.Jump.Fire(true); // the same value on the same binding: a no-op
				holder.Destroy();
				frames(3);
				expectTrue(jump.IsPressed(), "the keeper's press, which it never let go");
				jump.Fire(false);
			});

			// ---- Server Authority stand-ins of several root handles (design spec sections 4 and 8)

			test("Create twice before the copy: one enabled state, whichever handle changes it", () => {
				const { First: first, Second: second } = twoHandlesBeforeCopy();
				first.R3StandIn.SetEnabled(false);
				expectFalse(second.R3StandIn.IsEnabled(), "the second handle's view of the context");
				expectFalse(second.R3StandIn.Instance.Enabled, "the context the second handle wraps");
			});

			test("Create twice before the copy: the base state set through the second handle survives the swap", () => {
				const { First: first, Second: second, Arrive: arrive } = twoHandlesBeforeCopy();
				const secondChanges = recordSignal(second.R3StandIn.EnabledChanged);
				second.R3StandIn.SetEnabled(false);
				const copy = arrive();
				frames(3);
				expectEqual(
					secondChanges[secondChanges.size() - 1],
					second.R3StandIn.IsEnabled(),
					"the second handle's EnabledChanged agrees with its IsEnabled",
				);
				expectFalse(copy.Enabled, "the base state the second handle set");
				expectFalse(first.R3StandIn.IsEnabled());
			});

			test("Create twice before the copy: the base state set through the first handle survives the swap", () => {
				const { First: first, Second: second, Arrive: arrive } = twoHandlesBeforeCopy();
				const firstChanges = recordSignal(first.R3StandIn.EnabledChanged);
				first.R3StandIn.SetEnabled(false);
				const copy = arrive();
				frames(3);
				expectEqual(
					firstChanges[firstChanges.size() - 1],
					first.R3StandIn.IsEnabled(),
					"the first handle's EnabledChanged agrees with its IsEnabled",
				);
				expectFalse(copy.Enabled, "the base state the first handle set");
				expectFalse(second.R3StandIn.IsEnabled());
			});

			test("a Bool held by Fire across the swap: the handle's Pressed and Released alternate", () => {
				const folderName = uniqueFolderName();
				const schema = InputActions.Schema({
					R3Held: {
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
				const poke = input.R3Held.Actions.Poke;
				const events = new Array<string>();
				const pressed = poke.Pressed.Connect(() => events.push("Pressed"));
				const released = poke.Released.Connect(() => events.push("Released"));
				defer(() => {
					pressed.Disconnect();
					released.Disconnect();
				});
				poke.Fire(true);
				eventually(() => events.size() === 1, "the stand-in's Pressed");
				localCopy(folderName, "R3Held", [["Poke", Enum.InputActionType.Bool]]);
				eventually(() => input.R3Held.IsLinkedToServer(), "the link");
				eventually(() => poke.IsPressed(), "Poke held on the copy");
				frames(10);
				const sequence = events.join(",");
				expectTrue(
					sequence.find("Pressed,Pressed", 1, true)[0] === undefined,
					`a Pressed without a Released before it: ${sequence}`,
				);
				poke.Fire(false);
			});

			// ---- AttachButton

			test("AttachButton on a button already destroyed leaves no binding behind", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = newButton();
				button.Destroy();
				const detach = jump.AttachButton(button);
				frames(3);
				const left = bindingsOf(jump.Instance).filter(
					(binding) => (binding as InputBinding).UIButton === button,
				);
				detach();
				expectEqual(left.size(), 0, "bindings for the destroyed button");
			});

			// ---- round trips and merges that must hold (expected to pass)

			test("Clear, then Set composites, then a save round trip", () => {
				const input = createTestInput();
				const pad = input.Gameplay.Actions.Move.Bindings.Gamepad;
				pad.Clear();
				pad.Set({ Up: K.DPadUp, Down: K.DPadDown });
				expectEqual(pad.Instance.KeyCode, K.None);
				expectEqual(pad.Instance.Left, K.None);
				const json = input.ExportBindings();
				input.ResetBindings();
				expectEqual(pad.Instance.KeyCode, K.Thumbstick1);
				const result = input.ImportBindings(json);
				expectArrayEqual(describeSkipped(result), []);
				expectEqual(pad.Instance.KeyCode, K.None);
				expectEqual(pad.Instance.Up, K.DPadUp);
				expectEqual(pad.Instance.Down, K.DPadDown);
				expectEqual(input.ExportBindings(), json);
			});

			test("Reset after an import returns to the defaults, not to the save", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				input.ImportBindings(save({ "Gameplay/Jump/KeyboardAndMouse": { KeyCode: "G" } }));
				expectEqual(jump.Instance.KeyCode, K.G);
				jump.Reset();
				expectEqual(jump.Instance.KeyCode, K.Space);
			});

			test("an empty entry applies and changes nothing; odd saves apply nothing", () => {
				const input = createTestInput();
				const result = input.ImportBindings(save({ "Gameplay/Jump/KeyboardAndMouse": {} }));
				expectArrayEqual(describeSkipped(result), []);
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Space,
				);
				for (const json of [
					'{"Version":1,"Bindings":null}',
					'{"Version":"1","Bindings":{}}',
					"null",
					'""',
				]) {
					const odd = input.ImportBindings(json);
					expectArrayEqual(odd.Applied, [], json);
					expectEqual(odd.Skipped.size(), 1, json);
				}
			});

			test("a bare key keeps the Bool binding's thresholds and modifiers", () => {
				const actions = createTestInput().Gameplay.Actions;
				const fire = actions.Fire.Bindings.Gamepad;
				fire.Set(K.ButtonL2);
				expectEqual(fire.Instance.KeyCode, K.ButtonL2);
				expectEqual(fire.Get().PressedThreshold, 0.6);
				const quick = actions.QuickSave.Bindings.KeyboardAndMouse;
				quick.Set(K.X);
				expectEqual(quick.Instance.PrimaryModifier, K.LeftControl, "Ctrl+X");
			});

			test("Set(Get()) is accepted for every rebindable binding and changes nothing", () => {
				const input = createTestInput();
				const before = input.ExportBindings();
				for (const [contextName, context] of pairs(input as unknown as Record<string, unknown>)) {
					if (!typeIs(context, "table")) continue; // the root's functions
					const actions = (context as { Actions?: Record<string, { Bindings: object }> }).Actions;
					if (actions === undefined) continue;
					for (const [actionName, action] of pairs(actions)) {
						for (const [slot, binding] of pairs(action.Bindings as Record<string, object>)) {
							const handle = binding as { Get?(): unknown; Set(spec: unknown): void };
							if (handle.Get === undefined) continue; // Scriptable
							const data = handle.Get();
							const [ok, problem] = pcall(() => handle.Set(data));
							expectTrue(ok, `${contextName}/${actionName}/${slot}: ${problem}`);
						}
					}
				}
				expectEqual(input.ExportBindings(), before);
			});

			test("a DisplayImage set through Set is read back by Get and undone by Reset", () => {
				const jump = createTestInput().Gameplay.Actions.Jump.Bindings.KeyboardAndMouse;
				jump.Set({ KeyCode: K.Space, DisplayImage: "rbxassetid://123", DisplayName: "Jump" });
				expectEqual(jump.Get().DisplayImage, "rbxassetid://123");
				expectEqual(jump.Get().DisplayName, "Jump");
				jump.Reset();
				expectEqual(jump.Get().DisplayImage, undefined);
				expectEqual(jump.Get().DisplayName, undefined);
			});

			test("a ResponseCurve beside KeyCode None is skipped by import", () => {
				const input = createTestInput();
				const result = input.ImportBindings(
					save({ "Gameplay/Move/Gamepad": { KeyCode: "None", ResponseCurve: 3 } }),
				);
				expectArrayEqual(result.Applied, []);
				expectEqual(input.Gameplay.Actions.Move.Bindings.Gamepad.Instance.KeyCode, K.Thumbstick1);
			});
		});
	}
}
