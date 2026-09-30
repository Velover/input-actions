import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, Players, ReplicatedStorage } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, createTestInput, frames, nearlyEqual, newFolder, recordWarnings } from "./helpers";

// Validator round 4: adversarial client tests (binding properties IAS clamps, hostile saves, and
// the Server Authority stand-in when its root handle goes before the server's copy arrives).

const K = Enum.KeyCode;

function save(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function describeSkipped(result: InputActions.ImportResult) {
	return result.Skipped.map((skipped) => `${skipped.Path}: ${skipped.Reason}`);
}

let folderCount = 0;
/** A player folder name no server provides: the tests play the server's copy on the client */
function uniqueFolderName() {
	folderCount++;
	return `ValidatorR4Copy${folderCount}`;
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
	R4StandIn: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: K.P }),
			Move: InputActions.Direction2D({ Virtual: InputActions.Scriptable }),
		},
	},
});

function standInCopy(folderName: string) {
	return localCopy(folderName, "R4StandIn", [
		["Poke", Enum.InputActionType.Bool],
		["Move", Enum.InputActionType.Direction2D],
	]);
}

/** A save as sorted `path.property=value` lines, whatever order JSONEncode wrote the keys in */
function canonical(json: string) {
	const decoded = HttpService.JSONDecode(json) as { Bindings: Record<string, Record<string, unknown>> };
	const lines = new Array<string>();
	for (const [path, entry] of pairs(decoded.Bindings)) {
		for (const [name, value] of pairs(entry)) {
			const text = typeIs(value, "table")
				? (value as defined[]).map((item) => tostring(item)).join(",")
				: tostring(value);
			lines.push(`${path}.${name}=${text}`);
		}
	}
	lines.sort();
	return lines.join("; ");
}

function bindingCount(root: Instance) {
	return root
		.GetDescendants()
		.filter((descendant) => descendant.IsA("InputBinding"))
		.size();
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR4ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r4", () => {
			// ---- properties IAS clamps as they are written (probed: ReleasedThreshold reads as
			// min(itself, PressedThreshold), ResponseCurve is kept within 1..10)

			test("thresholds below and above the defaults: Set, Get, Reset and a save round trip", () => {
				const input = createTestInput();
				const pad = input.Gameplay.Actions.Fire.Bindings.Gamepad;
				pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.1, ReleasedThreshold: 0.05 });
				expectTrue(nearlyEqual(pad.Instance.PressedThreshold, 0.1), "PressedThreshold 0.1");
				expectTrue(nearlyEqual(pad.Instance.ReleasedThreshold, 0.05), "ReleasedThreshold 0.05");
				const low = input.ExportBindings();
				pad.Reset();
				expectTrue(nearlyEqual(pad.Instance.PressedThreshold, 0.6), "the schema's 0.6 back");
				expectTrue(nearlyEqual(pad.Instance.ReleasedThreshold, 0.2), "the default 0.2 back");

				pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.95, ReleasedThreshold: 0.9 });
				expectTrue(nearlyEqual(pad.Instance.ReleasedThreshold, 0.9), "ReleasedThreshold 0.9");
				const high = input.ExportBindings();
				pad.Reset();
				expectTrue(nearlyEqual(pad.Instance.ReleasedThreshold, 0.2), "Reset from above the defaults");

				for (const json of [low, high]) {
					const result = input.ImportBindings(json);
					expectArrayEqual(describeSkipped(result), [], json);
					expectEqual(input.ExportBindings(), json, "the import exports the same save");
				}
			});

			test("a ResponseCurve beyond what IAS keeps imports, and its export imports cleanly", () => {
				const input = createTestInput();
				const result = input.ImportBindings(
					save({ "Gameplay/Move/Gamepad": { KeyCode: "Thumbstick1", ResponseCurve: 25 } }),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Move/Gamepad"]);
				const json = input.ExportBindings();
				const again = input.ImportBindings(json);
				expectArrayEqual(describeSkipped(again), [], json);
				expectEqual(input.ExportBindings(), json);
			});

			// ---- hostile saves: ImportBindings never throws, SanitizeBindings always returns a save

			test("hostile saves never throw, and apply nothing they shouldn't", () => {
				const input = createTestInput();
				// Nested about 300 deep, a save crashes the whole Roblox process inside
				// HttpService:JSONDecode, pcall or not (validator round 4 finding R4-F2): the package
				// refuses a save nested deeper than a save can be before decoding it
				const deep = `${string.rep("[", 1000)}${string.rep("]", 1000)}`;
				const saves = [
					deep,
					`{"Version":1,"Bindings":${deep}}`,
					'{"Version":1,"Bindings":[{"KeyCode":"F"}]}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":[]}}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":["F"]}}}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":{"Name":"F"}}}}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":true}}}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"1":"F"}}}',
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Vector2Scale":[1,null,2]}}}',
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Vector2Scale":{"X":1,"Y":2}}}}',
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Scale":"2"}}}',
					'{"Version":1,"Bindings":{"Gameplay/Look/Mouse":{"Scale":1e999}}}',
					'{"Version":1,"Bindings":{"__index":{"KeyCode":"F"},"Gameplay/Jump/KeyboardAndMouse/":{}}}',
					'{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"F\\u0000"}}}',
					'{"Version":1e0,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"MouseLeftButton"}}}',
					`{"Version":1,"Bindings":{"Gameplay/Jump/KeyboardAndMouse":{"KeyCode":"${string.rep("A", 100000)}"}}}`,
				];
				for (const json of saves) {
					const [ok, result] = pcall(() => input.ImportBindings(json));
					expectTrue(ok, `ImportBindings threw on ${json.sub(1, 80)}: ${result}`);
					const [cleanOk, clean] = pcall(() => InputActions.SanitizeBindings(TEST_SCHEMA, json));
					expectTrue(cleanOk, `SanitizeBindings threw on ${json.sub(1, 80)}: ${clean}`);
				}
				// only the last-but-one save is valid: a mouse button on Jump
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance.KeyCode,
					K.Space,
					"the last save reset everything",
				);
				const valid = input.ImportBindings(saves[saves.size() - 2]);
				expectArrayEqual(valid.Applied, ["Gameplay/Jump/KeyboardAndMouse"]);
			});

			test("what SanitizeBindings returns imports without a skip, and cleaning it again changes nothing", () => {
				const messy = save({
					"Gameplay/Jump/KeyboardAndMouse": { KeyCode: "F", PrimaryModifier: "LeftShift" },
					"Gameplay/Jump/Gamepad": { KeyCode: "Escape" },
					"Gameplay/Fire/Gamepad": { PressedThreshold: 0.3, ReleasedThreshold: 0.1 },
					"Gameplay/Move/Gamepad": { ResponseCurve: 3, Scale: 0.5 },
					"Gameplay/Move/KeyboardAndMouse": { Up: "Up", KeyCode: "Thumbstick1" },
					"Gameplay/Move/Virtual": { KeyCode: "F" },
					"Gameplay/Look/Mouse": { Vector2Scale: [2, -2], Scale: 0.123456789 },
					"Gameplay/Zoom/Gamepad": { Up: "Unknown", Down: "DPadLeft" },
					"Gameplay/Fly/Keyboard": { Forward: "I", Vector3Scale: [1, 2, 3] },
					"Gameplay/Aim/Pointer": { KeyCode: "TouchPosition" },
					"Ui/Scroll/Mouse": { KeyCode: "TrackpadPinch" },
					"Nope/Jump/KeyboardAndMouse": { KeyCode: "F" },
				});
				const clean = InputActions.SanitizeBindings(TEST_SCHEMA, messy);
				expectEqual(
					canonical(InputActions.SanitizeBindings(TEST_SCHEMA, clean)),
					canonical(clean),
					"idempotent",
				);
				const input = createTestInput();
				const result = input.ImportBindings(clean);
				expectArrayEqual(describeSkipped(result), [], clean);
				expectEqual(result.Applied.size(), 8, `applied: ${result.Applied.join(", ")}`);
			});

			// ---- the Server Authority stand-in when its only root handle goes first (spec §8, §4)

			test("a root handle destroyed before the copy arrives leaves nothing, and a later Create links at once", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(STAND_IN_SCHEMA, options);
				const standIn = first.R4StandIn.Instance;
				first.R4StandIn.Actions.Poke.Fire(true);
				first.R4StandIn.Actions.Move.Bindings.Virtual.Fire(new Vector2(0, 1));
				first.Destroy();
				expectEqual(standIn.Parent, undefined, "the stand-in is gone with its only handle");
				const standIns = ReplicatedStorage.FindFirstChild("InputActionsStandIns");
				expectTrue(
					standIns === undefined || standIns.FindFirstChild("R4StandIn") === undefined,
					"nothing of it is left in the stand-ins' folder",
				);

				const copy = standInCopy(folderName);
				frames(3);
				expectEqual(bindingCount(copy), 0, "nothing swapped to the copy");

				const second = InputActions.Create(STAND_IN_SCHEMA, options);
				defer(() => second.Destroy());
				const linked = countSignal(second.R4StandIn.LinkedToServer);
				expectTrue(second.R4StandIn.IsLinkedToServer(), "on the copy from the start");
				expectEqual(second.R4StandIn.Instance, copy);
				expectFalse(second.R4StandIn.Actions.Poke.IsPressed(), "the first handle's press is gone");
				expectEqual(second.R4StandIn.Actions.Move.GetState(), Vector2.zero);
				frames(3);
				expectEqual(linked.count, 0, "LinkedToServer never fires");
			});

			test("Destroy, then Create again before the copy: a new stand-in that still swaps once", () => {
				const folderName = uniqueFolderName();
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const first = InputActions.Create(STAND_IN_SCHEMA, options);
				first.Destroy();
				const second = InputActions.Create(STAND_IN_SCHEMA, options);
				defer(() => second.Destroy());
				const linked = countSignal(second.R4StandIn.LinkedToServer);
				const poke = second.R4StandIn.Actions.Poke;
				poke.Fire(true);
				const copy = standInCopy(folderName);
				eventually(() => second.R4StandIn.IsLinkedToServer(), "the link");
				eventually(() => poke.IsPressed(), "the press carried over");
				expectEqual(second.R4StandIn.Instance, copy);
				frames(3);
				expectEqual(linked.count, 1, "LinkedToServer fires once");
				expectEqual(bindingCount(copy), 3, "PokeKeyboardAndMouse, PokeScript and MoveVirtual, once each");
				poke.Fire(false);
			});

			test("a stand-in's Timeout warning comes once per waiting root handle and names the path", () => {
				const warnings = recordWarnings();
				const folderName = uniqueFolderName();
				const input = InputActions.Create(STAND_IN_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: folderName,
					Timeout: 0.2,
				});
				defer(() => input.Destroy());
				const mine = () =>
					warnings.filter((message) => message.find(folderName, 1, true)[0] !== undefined);
				eventually(() => mine().size() > 0, "the Timeout warning", 3);
				task.wait(0.5);
				expectEqual(mine().size(), 1, mine().join(" | "));
				const message = mine()[0];
				expectTrue(message.find("R4StandIn", 1, true)[0] !== undefined, message);
				expectNoThrow(() => input.R4StandIn.Actions.Poke.Fire(false));
			});
		});
	}
}
