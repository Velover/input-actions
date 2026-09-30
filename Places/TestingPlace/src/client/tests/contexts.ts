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
import { Players } from "@rbxts/services";
import { countSignal, createTestInput, frames, newFolder, recordSignal } from "./helpers";

function newTextBox() {
	const gui = new Instance("ScreenGui");
	gui.Name = "InputActionsFocusTest";
	gui.ResetOnSpawn = false;
	const box = new Instance("TextBox");
	box.Size = UDim2.fromOffset(200, 50);
	box.Parent = gui;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => {
		box.ReleaseFocus();
		gui.Destroy();
	});
	return box;
}

/** Context enable model: base state, requests, focus-loss reset (design spec §5) */
@Provider({ activeIn: ["testing"] })
export class ContextTests implements OnStart {
	onStart() {
		defineTests("contexts", () => {
			test("the base state starts as the instance's Enabled", () => {
				const input = createTestInput();
				expectTrue(input.Gameplay.IsEnabled());
				expectFalse(input.Menu.IsEnabled());
				expectFalse(input.Ui.IsEnabled());
				expectEqual(input.Gameplay.Instance.ClassName, "InputContext");
			});

			test("SetEnabled writes the instance and fires EnabledChanged", () => {
				const input = createTestInput();
				const changes = recordSignal(input.Menu.EnabledChanged);
				input.Menu.SetEnabled(true);
				expectTrue(input.Menu.IsEnabled());
				expectTrue(input.Menu.Instance.Enabled);
				input.Menu.SetEnabled(true);
				input.Menu.SetEnabled(false);
				expectFalse(input.Menu.Instance.Enabled);
				eventually(() => changes.size() === 2, "two changes");
				expectArrayEqual(changes, [true, false]);
			});

			test("any false request wins; else any true request; else the base state", () => {
				const gameplay = createTestInput().Gameplay;
				const holdOn = gameplay.Request(true);
				expectTrue(gameplay.IsEnabled());
				const holdOff = gameplay.Request(false);
				expectFalse(gameplay.IsEnabled());
				expectFalse(gameplay.Instance.Enabled);
				gameplay.SetEnabled(true);
				expectFalse(gameplay.IsEnabled());
				holdOff();
				expectTrue(gameplay.IsEnabled());
				gameplay.SetEnabled(false);
				expectTrue(gameplay.IsEnabled()); // the true request overrides the base state
				holdOn();
				expectFalse(gameplay.IsEnabled());
				expectFalse(gameplay.Instance.Enabled);
			});

			test("calling a release function twice is a no-op", () => {
				const gameplay = createTestInput().Gameplay;
				const first = gameplay.Request(false);
				const second = gameplay.Request(false);
				first();
				first();
				expectFalse(gameplay.IsEnabled());
				second();
				expectTrue(gameplay.IsEnabled());
			});

			test("disabling a context releases its held actions", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				jump.Fire(true);
				frames(2);
				const release = input.Gameplay.Request(false);
				expectFalse(jump.GetState());
				eventually(() => released.count === 1, "Released");
				// Fire is ignored while the context is disabled
				jump.Fire(true);
				release();
				expectFalse(jump.GetState());
			});

			test("focus loss holds every context off for one frame", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const gameplayChanges = recordSignal(input.Gameplay.EnabledChanged);
				const menuChanges = recordSignal(input.Menu.EnabledChanged);
				jump.Fire(true);
				frames(2);

				newTextBox().CaptureFocus();
				eventually(() => !jump.GetState(), "the held action to be released");
				eventually(
					() => input.Gameplay.IsEnabled() && gameplayChanges.size() === 2,
					"the context back on",
				);
				expectArrayEqual(gameplayChanges, [false, true]);
				expectTrue(input.Gameplay.Instance.Enabled);
				// a disabled context stays disabled and hears nothing
				expectFalse(input.Menu.IsEnabled());
				expectArrayEqual(menuChanges, []);
			});

			test("focus loss over held requests: one false/true pair, the requests still hold", () => {
				const input = createTestInput();
				const menuChanges = recordSignal(input.Menu.EnabledChanged);
				const gameplayChanges = recordSignal(input.Gameplay.EnabledChanged);
				const openMenu = input.Menu.Request(true); // over its base state false
				const pauseGameplay = input.Gameplay.Request(false);
				newTextBox().CaptureFocus();
				eventually(() => menuChanges.size() === 3, "the Menu's changes");
				expectArrayEqual(menuChanges, [true, false, true]);
				expectTrue(input.Menu.IsEnabled());
				expectTrue(input.Menu.Instance.Enabled);
				frames(3);
				expectArrayEqual(gameplayChanges, [false], "a context held off hears nothing more");
				openMenu();
				expectFalse(input.Menu.IsEnabled(), "back to the base state");
				pauseGameplay();
				expectTrue(input.Gameplay.IsEnabled());
			});

			test("ResetOnFocusLoss: false keeps held actions through focus loss", () => {
				const input = createTestInput(newFolder(), { ResetOnFocusLoss: false });
				const jump = input.Gameplay.Actions.Jump;
				jump.Fire(true);
				frames(2);
				newTextBox().CaptureFocus();
				frames(5);
				expectTrue(jump.GetState());
				expectTrue(input.Gameplay.IsEnabled());
			});
		});
	}
}
