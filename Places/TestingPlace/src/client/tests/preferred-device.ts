import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { UserInputService } from "@rbxts/services";
import { frames } from "./helpers";
import { emptyPoint, realInput } from "./virtual";
import { virtualPad } from "./virtual-pad";

const K = Enum.KeyCode;

/** Records the devices `PreferredDeviceChanged` fires until the test ends */
function recordDevices() {
	const devices = new Array<InputActions.Device>();
	const connection = InputActions.PreferredDeviceChanged.Connect((device) => devices.push(device));
	defer(() => connection.Disconnect());
	return devices;
}

/**
 * `InputActions.PreferredDeviceChanged` (0.7.0, F1): fires when `PreferredDevice()` changes, never
 * the same device twice in a row. Under the simulated phone a key press switches PreferredInput to
 * KeyboardAndMouse and a tap back to Touch (measured, 2026-10-03); elsewhere only a gamepad moves
 * it, through the virtual pad (opt-in: VIRTUAL_PAD=1)
 */
@Provider({ activeIn: ["testing"] })
export class PreferredDeviceTests implements OnStart {
	onStart() {
		defineTests("preferred-device", () => {
			test("keys and clicks on the keyboard's device fire nothing: never the same device twice", () => {
				if (getProject() === "touch")
					return skip("the touch project switches devices: the next test");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectEqual(InputActions.PreferredDevice(), "KeyboardAndMouse");
				const devices = recordDevices();
				real.Tap(K.N);
				real.Click(emptyPoint());
				real.Tap(K.ButtonX); // a gamepad KeyCode, which VirtualInput sends as a key
				frames(5);
				expectArrayEqual(devices, []);
				expectEqual(InputActions.PreferredDevice(), "KeyboardAndMouse");
			});

			test("on the phone: a key press fires KeyboardAndMouse, a tap Touch, once each", () => {
				if (getProject() !== "touch") return skip("the touch project only");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				real.Click(emptyPoint());
				eventually(() => InputActions.PreferredDevice() === "Touch", "Touch after a tap");
				frames(2);
				const devices = recordDevices();
				real.Tap(K.N);
				eventually(() => devices.size() === 1, `the key press${real.FocusNote()}`);
				expectArrayEqual(devices, ["KeyboardAndMouse"]);
				expectEqual(InputActions.PreferredDevice(), "KeyboardAndMouse");
				real.Tap(K.U);
				frames(3);
				expectArrayEqual(devices, ["KeyboardAndMouse"], "a second key: the same device");
				real.Click(emptyPoint());
				eventually(() => devices.size() === 2, `the tap${real.FocusNote()}`);
				real.Click(emptyPoint());
				frames(3);
				expectArrayEqual(devices, ["KeyboardAndMouse", "Touch"]);
				expectEqual(InputActions.PreferredDevice(), "Touch");
			});

			test("the same signal each read, connected once", () => {
				const signal = InputActions.PreferredDeviceChanged;
				expectEqual(InputActions.PreferredDeviceChanged, signal);
				expectEqual(typeOf(signal), "RBXScriptSignal");
				const first = recordDevices();
				const second = recordDevices();
				if (getProject() !== "touch") return;
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				real.Click(emptyPoint());
				real.Tap(K.N);
				eventually(
					() => second.size() > 0 && second[second.size() - 1] === "KeyboardAndMouse",
					"the switch",
				);
				expectArrayEqual(first, second, "every connection hears the same");
			});

			test("plugging a gamepad in fires Gamepad, unplugging it the keyboard's device", () => {
				if (getProject() === "touch")
					return skip("under the simulated phone PreferredInput stays Touch");
				const pad = virtualPad({ Input: false });
				if (typeIs(pad, "string")) return skip(pad);
				if (UserInputService.GetConnectedGamepads().size() > 0)
					return skip("a gamepad is connected already");
				const devices = recordDevices();
				if (pad.Connect() === undefined) return skip("Roblox never listed the virtual pad");
				eventually(() => devices.size() === 1, "Gamepad once plugged in", 3);
				pad.Disconnect();
				eventually(() => devices.size() === 2, "the keyboard's once unplugged", 3);
				frames(5);
				expectArrayEqual(devices, ["Gamepad", "KeyboardAndMouse"]);
			});
		});
	}
}
