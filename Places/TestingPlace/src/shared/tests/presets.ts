import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";

function sortedKeys(record: object) {
	const keys = new Array<string>();
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

/** Presets.UiNavigation (design spec §9) */
@Provider({ activeIn: ["testing"] })
export class PresetTests implements OnStart {
	onStart() {
		defineTests("presets", () => {
			test("UiNavigation has the six actions with their types", () => {
				const ui = InputActions.Presets.UiNavigation();
				expectArrayEqual(sortedKeys(ui.Actions), [
					"Accept",
					"Cancel",
					"Navigate",
					"NextPage",
					"PreviousPage",
					"Scroll",
				]);
				expectEqual(ui.Actions.Navigate.Type, Enum.InputActionType.Direction2D);
				expectEqual(ui.Actions.Accept.Type, Enum.InputActionType.Bool);
				expectEqual(ui.Actions.Cancel.Type, Enum.InputActionType.Bool);
				expectEqual(ui.Actions.NextPage.Type, Enum.InputActionType.Bool);
				expectEqual(ui.Actions.PreviousPage.Type, Enum.InputActionType.Bool);
				expectEqual(ui.Actions.Scroll.Type, Enum.InputActionType.Direction1D);
			});

			test("UiNavigation bindings follow the spec table", () => {
				const actions = InputActions.Presets.UiNavigation().Actions;
				const navigate = actions.Navigate.Bindings;
				expectEqual(navigate.KeyboardAndMouse.Up, Enum.KeyCode.Up);
				expectEqual(navigate.KeyboardAndMouse.Down, Enum.KeyCode.Down);
				expectEqual(navigate.KeyboardAndMouse.Left, Enum.KeyCode.Left);
				expectEqual(navigate.KeyboardAndMouse.Right, Enum.KeyCode.Right);
				expectEqual(navigate.Gamepad.Up, Enum.KeyCode.DPadUp);
				expectEqual(navigate.Gamepad.Down, Enum.KeyCode.DPadDown);
				expectEqual(navigate.Gamepad.Left, Enum.KeyCode.DPadLeft);
				expectEqual(navigate.Gamepad.Right, Enum.KeyCode.DPadRight);
				expectEqual(actions.Accept.Bindings.KeyboardAndMouse, Enum.KeyCode.Return);
				expectEqual(actions.Accept.Bindings.Gamepad, Enum.KeyCode.ButtonA);
				expectEqual(actions.Cancel.Bindings.KeyboardAndMouse, Enum.KeyCode.B);
				expectEqual(actions.Cancel.Bindings.Gamepad, Enum.KeyCode.ButtonB);
				expectEqual(actions.NextPage.Bindings.KeyboardAndMouse, Enum.KeyCode.E);
				expectEqual(actions.NextPage.Bindings.Gamepad, Enum.KeyCode.ButtonR1);
				expectEqual(actions.PreviousPage.Bindings.KeyboardAndMouse, Enum.KeyCode.Q);
				expectEqual(actions.PreviousPage.Bindings.Gamepad, Enum.KeyCode.ButtonL1);
				const scroll = actions.Scroll.Bindings;
				expectEqual(scroll.Mouse, Enum.KeyCode.MouseWheel);
				expectEqual(scroll.KeyboardAndMouse.Up, Enum.KeyCode.PageUp);
				expectEqual(scroll.KeyboardAndMouse.Down, Enum.KeyCode.PageDown);
				expectEqual(scroll.Gamepad.Up, Enum.KeyCode.Thumbstick2Up);
				expectEqual(scroll.Gamepad.Down, Enum.KeyCode.Thumbstick2Down);
			});

			test("UiNavigation passes its options through", () => {
				const ui = InputActions.Presets.UiNavigation({
					Priority: 3000,
					Sink: true,
					Enabled: false,
					ServerAuthority: true,
				});
				expectEqual(ui.Priority, 3000);
				expectTrue(ui.Sink);
				expectFalse(ui.Enabled);
				expectTrue(ui.ServerAuthority);
				const plain = InputActions.Presets.UiNavigation();
				expectEqual((plain as { Priority?: number }).Priority, undefined);
			});

			test("UiNavigation goes into a schema like a hand-written context", () => {
				const schema = InputActions.Schema({
					Ui: InputActions.Presets.UiNavigation({ Enabled: false }),
				});
				expectEqual(schema.Contexts.Ui.Actions.Accept.Type, Enum.InputActionType.Bool);
			});
		});
	}
}
