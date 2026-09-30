import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { TEST_SCHEMA } from "shared/fixtures/schemas";

function sortedKeys(record: object) {
	const keys = new Array<string>();
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

/** A schema the types would reject, to reach the runtime checks */
function untypedSchema(contexts: unknown) {
	return (InputActions.Schema as (contexts: unknown) => unknown)(contexts);
}

/** Builders and Schema: plain data on both realms (design spec §3, §4) */
@Provider({ activeIn: ["testing"] })
export class SchemaTests implements OnStart {
	onStart() {
		defineTests("schema", () => {
			test("builders return definitions of their action type", () => {
				const jump = InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space });
				expectEqual(jump.Type, Enum.InputActionType.Bool);
				expectEqual(jump.Bindings.KeyboardAndMouse, Enum.KeyCode.Space);
				expectFalse(jump.TrackPrevious);
				expectEqual(InputActions.Direction1D().Type, Enum.InputActionType.Direction1D);
				expectEqual(InputActions.Direction2D().Type, Enum.InputActionType.Direction2D);
				expectEqual(InputActions.Direction3D().Type, Enum.InputActionType.Direction3D);
				expectEqual(InputActions.ViewportPosition().Type, Enum.InputActionType.ViewportPosition);
			});

			test("builder options: TrackPrevious, DisplayName, Enabled", () => {
				const crouch = InputActions.Bool(
					{ KeyboardAndMouse: Enum.KeyCode.C },
					{ TrackPrevious: true, DisplayName: "Crouch", Enabled: false },
				);
				expectTrue(crouch.TrackPrevious);
				expectEqual(crouch.DisplayName, "Crouch");
				expectEqual(crouch.Enabled, false);
			});

			test("an action without bindings has an empty binding record", () => {
				const dash = InputActions.Bool();
				expectArrayEqual(sortedKeys(dash.Bindings), []);
			});

			test("Scriptable is one marker value", () => {
				const move = InputActions.Direction2D({ Virtual: InputActions.Scriptable });
				expectEqual(move.Bindings.Virtual, InputActions.Scriptable);
				expectEqual(tostring(InputActions.Scriptable), "InputActions.Scriptable");
			});

			test("Schema returns a frozen { Contexts }", () => {
				expectTrue(table.isfrozen(TEST_SCHEMA));
				expectTrue(table.isfrozen(TEST_SCHEMA.Contexts));
				expectTrue(table.isfrozen(TEST_SCHEMA.Contexts.Gameplay.Actions));
				expectArrayEqual(sortedKeys(TEST_SCHEMA.Contexts), ["Gameplay", "Menu", "Ui"]);
				expectEqual(TEST_SCHEMA.Contexts.Gameplay.Priority, 2000);
				expectEqual(TEST_SCHEMA.Contexts.Menu.Enabled, false);
			});

			test("Schema creates no instances", () => {
				const before = game.GetDescendants().size();
				InputActions.Schema({ Temp: { Actions: { A: InputActions.Bool({ K: Enum.KeyCode.K }) } } });
				expectEqual(game.GetDescendants().size(), before);
			});

			test("Schema checks bindings the types could not see", () => {
				const message = expectThrows(() =>
					untypedSchema({
						Gameplay: {
							Actions: { Jump: InputActions.Bool({ Mouse: Enum.KeyCode.MouseDelta as never }) },
						},
					}),
				);
				expectTrue(message.find("Gameplay/Jump/Mouse", 1, true)[0] !== undefined, message);
				expectThrows(() =>
					untypedSchema({
						Gameplay: { Actions: { Jump: InputActions.Bool({ K: Enum.KeyCode.Escape as never }) } },
					}),
				);
				expectThrows(() => untypedSchema({ Gameplay: { Actions: { Jump: "nope" } } }));
				expectThrows(() => untypedSchema({ Gameplay: {} }));
			});

			test("Schema refuses a context option of the wrong type, and a misspelt preset option", () => {
				for (const [option, value] of [
					["ServerAuthority", "true"],
					["Priority", "2000"],
					["Sink", 1],
					["Enabled", "false"],
				] as Array<[string, unknown]>) {
					const context: Record<string, unknown> = { Actions: {} };
					context[option] = value;
					const message = expectThrows(() => untypedSchema({ Typed: context }), option);
					expectTrue(message.find(`Typed: ${option}`, 1, true)[0] !== undefined, message);
				}
				const preset = (InputActions.Presets.UiNavigation as (options: unknown) => unknown)({
					Priority: 3000,
					Snk: true,
				});
				const message = expectThrows(() => untypedSchema({ Menu: preset }));
				expectTrue(message.find('"Snk"', 1, true)[0] !== undefined, message);
				// every option spelt right, and none at all
				untypedSchema({
					Full: { ServerAuthority: false, Priority: 2000, Sink: true, Enabled: false, Actions: {} },
					Bare: { Actions: {} },
					Menu: InputActions.Presets.UiNavigation({ ServerAuthority: true, Priority: 3000 }),
				});
			});

			test("Schema refuses names the handles can't hold", () => {
				expectThrows(() => untypedSchema({ Destroy: { Actions: {} } }));
				expectThrows(() => untypedSchema({ ExportBindings: { Actions: {} } }));
				expectThrows(() => untypedSchema({ "A/B": { Actions: {} } }));
				expectThrows(() =>
					untypedSchema({ Gameplay: { Actions: { "Jump/Now": InputActions.Bool() } } }),
				);
			});

			test("Schema refuses slot names that would take the package's own binding names", () => {
				const withSlot = (slot: string) => () =>
					InputActions.Schema({
						Gameplay: { Actions: { Dash: InputActions.Bool({ [slot]: Enum.KeyCode.X }) } },
					});
				// DashScript is Fire's binding, DashUIButton<n> AttachButton's; a slot matches S or A..S
				for (const slot of ["Script", "UIButton1", "UIButton12", "DashScript", "DashUIButton2"]) {
					const message = expectThrows(withSlot(slot), slot);
					expectTrue(message.find(`Gameplay/Dash/${slot}`, 1, true)[0] !== undefined, message);
					expectTrue(message.find("reserved", 1, true)[0] !== undefined, message);
				}
				for (const slot of ["Scripts", "UIButton", "UIButtonA", "JumpScript", "Scriptable"]) {
					withSlot(slot)();
				}
			});

			test("Schema refuses slots S and <Action>S on one action: both would match one binding", () => {
				const message = expectThrows(() =>
					InputActions.Schema({
						Gameplay: {
							Actions: {
								Jump: InputActions.Bool({ Pad: Enum.KeyCode.ButtonA, JumpPad: Enum.KeyCode.ButtonB }),
							},
						},
					}),
				);
				expectTrue(message.find("Gameplay/Jump", 1, true)[0] !== undefined, message);
				expectTrue(message.find("JumpPad", 1, true)[0] !== undefined, message);
				// on two actions the names are fine
				InputActions.Schema({
					Gameplay: {
						Actions: {
							Jump: InputActions.Bool({ Pad: Enum.KeyCode.ButtonA }),
							Dash: InputActions.Bool({ JumpPad: Enum.KeyCode.ButtonB }),
						},
					},
				});
			});
		});
	}
}
