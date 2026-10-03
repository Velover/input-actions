import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectFalse,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { createTestInput } from "./helpers";

/** The UiNavigation preset, created (design spec §9) */
@Provider({ activeIn: ["testing"] })
export class PresetRuntimeTests implements OnStart {
	onStart() {
		defineTests("presets", () => {
			test("UiNavigation creates a working context with its options", () => {
				const input = createTestInput();
				const ui = input.Ui;
				expectEqual(ui.Instance.Priority, 3000);
				expectTrue(ui.Instance.Sink);
				expectFalse(ui.IsEnabled());
				ui.SetEnabled(true);

				const navigate = ui.Actions.Navigate;
				expectEqual(navigate.Type, Enum.InputActionType.Direction2D);
				expectEqual(navigate.Bindings.KeyboardAndMouse.Instance.Left, Enum.KeyCode.Left);
				expectEqual(navigate.Bindings.Gamepad.Instance.Right, Enum.KeyCode.DPadRight);
				navigate.Fire(new Vector2(0, -1));
				expectEqual(navigate.GetState(), new Vector2(0, -1));

				const scroll = ui.Actions.Scroll;
				expectEqual(scroll.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.MouseWheel);
				expectEqual(scroll.Bindings.Gamepad.Instance.Down, Enum.KeyCode.Thumbstick2Down);
				// every action has a Touch binding: the preset leaves it unbound
				expectEqual(scroll.Bindings.Touch.Instance.Name, "ScrollTouch");
				expectEqual(scroll.Bindings.Touch.Instance.KeyCode, Enum.KeyCode.None);
				scroll.Fire(1);
				expectEqual(scroll.GetState(), 1);

				ui.Actions.Accept.Fire(true);
				expectTrue(ui.Actions.Accept.IsPressed());
				expectEqual(ui.Actions.Cancel.Bindings.KeyboardAndMouse.Instance.KeyCode, Enum.KeyCode.B);
			});
		});
	}
}
