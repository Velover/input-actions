import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { HttpService, UserInputService } from "@rbxts/services";
import { createTestInput, frames, newFolder, recordSignal, recordWarnings } from "./helpers";
import { virtualPad } from "./virtual-pad";

const K = Enum.KeyCode;

interface ISave {
	Version: number;
	Bindings: Record<string, Record<string, unknown>>;
}

function decode(json: string) {
	return HttpService.JSONDecode(json) as ISave;
}

function encode(bindings: Record<string, unknown>) {
	return HttpService.JSONEncode({ Version: 1, Bindings: bindings });
}

function keysOf(record: object) {
	const keys = new Array<string>();
	for (const [key] of pairs(record as Record<string, unknown>)) keys.push(key as string);
	keys.sort();
	return keys;
}

function contains(text: string, part: string) {
	return text.find(part, 1, true)[0] !== undefined;
}

/** Calls Set past the types, to reach the runtime checks */
function untypedSet(handle: object, spec: unknown) {
	(handle as { Set(spec: unknown): void }).Set(spec);
}

/** A schema for Create twice on one folder: the first leaves Jump's Gamepad out, the second names it */
const KEYS_ONLY = InputActions.Schema({
	DevicesShared: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
const WITH_PAD = InputActions.Schema({
	DevicesShared: {
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonA }) },
	},
});

/** What `PreferredDevice` should read for `UserInputService.PreferredInput` */
function deviceFor(preferred: Enum.PreferredInput): InputActions.Device {
	if (preferred === Enum.PreferredInput.Touch) return "Touch";
	if (preferred === Enum.PreferredInput.KeyboardAndMouse) return "KeyboardAndMouse";
	return "Gamepad";
}

/**
 * Device bindings at runtime (0.7.0, design spec §4, §6): every action has the three device
 * bindings, each takes its device's keys, saves keep them, PreferredDevice picks one
 */
@Provider({ activeIn: ["testing"] })
export class DevicesTests implements OnStart {
	onStart() {
		defineTests("devices", () => {
			test("every action has the three device bindings: those the schema leaves out start unbound", () => {
				const actions = createTestInput().Gameplay.Actions;
				const dash = actions.Dash;
				for (const device of ["KeyboardAndMouse", "Gamepad", "Touch"] as const) {
					const binding = dash.Bindings[device];
					expectEqual(binding.Name, device);
					expectEqual(binding.Instance.Name, `Dash${device}`);
					expectEqual(binding.Instance.Parent, dash.Instance);
					expectEqual(binding.Instance.Type, Enum.InputBindingType.Automatic);
					expectArrayEqual(keysOf(binding.Get()), [], `${device}'s Get`);
				}
				// Jump names KeyboardAndMouse and Gamepad: Touch is unbound
				expectArrayEqual(keysOf(actions.Jump.Bindings.Touch.Get()), []);
				expectEqual(actions.Jump.Bindings.Touch.Instance.KeyCode, K.None);
				// a Scriptable slot is beside them
				expectEqual(actions.Move.Bindings.Virtual.Instance.Type, Enum.InputBindingType.Scriptable);
			});

			test("an unbound device binding takes its device's keys; Reset makes it unbound again", () => {
				const input = createTestInput();
				const changes = recordSignal(input.BindingsChanged);
				const fly = input.Gameplay.Actions.Fly;
				fly.Bindings.Gamepad.Set({ Forward: K.ButtonY, Backward: K.ButtonA, Up: K.Thumbstick1Up });
				expectEqual(fly.Bindings.Gamepad.Instance.Forward, K.ButtonY);
				expectEqual(fly.Bindings.Gamepad.Get().Up, K.Thumbstick1Up);
				const jumpTouch = input.Gameplay.Actions.Jump.Bindings.Touch;
				jumpTouch.Set(K.TouchPosition);
				expectEqual(jumpTouch.Instance.KeyCode, K.TouchPosition);
				eventually(() => changes.size() === 2, "two BindingsChanged");
				expectArrayEqual(changes, ["Gameplay/Fly/Gamepad", "Gameplay/Jump/Touch"]);
				fly.Bindings.Gamepad.Reset();
				jumpTouch.Reset();
				expectArrayEqual(keysOf(fly.Bindings.Gamepad.Get()), []);
				expectEqual(jumpTouch.Instance.KeyCode, K.None);
			});

			test("Set refuses another device's key, naming the path and the device", () => {
				const actions = createTestInput().Gameplay.Actions;
				const jump = actions.Jump;
				const message = expectThrows(() => untypedSet(jump.Bindings.Gamepad, K.Space));
				expectTrue(contains(message, "Gameplay/Jump/Gamepad"), message);
				expectTrue(contains(message, "Space is a KeyboardAndMouse key"), message);
				expectThrows(() => untypedSet(jump.Bindings.KeyboardAndMouse, K.ButtonA));
				expectThrows(() => untypedSet(jump.Bindings.KeyboardAndMouse, K.TouchPosition));
				expectThrows(() => untypedSet(jump.Bindings.Touch, K.E));
				expectThrows(() =>
					untypedSet(jump.Bindings.Gamepad, { KeyCode: K.ButtonA, PrimaryModifier: K.LeftShift }),
				);
				expectThrows(() => untypedSet(actions.Move.Bindings.Gamepad, { Up: K.W }));
				expectThrows(() => untypedSet(actions.Aim.Bindings.Gamepad, K.MousePosition));
				expectEqual(jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA, "unchanged");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.KeyCode, K.Space, "unchanged");
			});

			test("the Touch binding has no captures; they throw if called anyway", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const touch = jump.Bindings.Touch as unknown as {
					Capture(slot: string, callback: () => void): () => void;
					CaptureChord(callback: () => void): () => void;
				};
				const message = expectThrows(() => touch.Capture("KeyCode", () => {}));
				expectTrue(contains(message, "Gameplay/Jump/Touch"), message);
				expectTrue(contains(message, "touch has no keys to press"), message);
				expectThrows(() => touch.CaptureChord(() => {}));
			});

			test("the action's Capture and CaptureChord throw on other action types", () => {
				const actions = createTestInput().Gameplay.Actions;
				for (const action of [actions.Move, actions.Look, actions.Fly, actions.Aim] as unknown[]) {
					const untyped = action as {
						Name: string;
						Capture(callback: () => void): () => void;
						CaptureChord(callback: () => void): () => void;
					};
					const message = expectThrows(() => untyped.Capture(() => {}), untyped.Name);
					expectTrue(contains(message, "Bool or Direction1D"), message);
					expectThrows(() => untyped.CaptureChord(() => {}), untyped.Name);
				}
				// and stop at once on the ones that have them
				actions.Jump.Capture(() => {})();
				actions.Zoom.CaptureChord(() => {})();
				expectThrows(() => actions.Jump.CaptureChord(() => {}, { Timeout: 0 }));
			});

			test("saves keep device bindings the schema leaves out, and skip 0.6's other names with a reason", () => {
				const input = createTestInput();
				const actions = input.Gameplay.Actions;
				actions.Fly.Bindings.Gamepad.Set({ Forward: K.ButtonY });
				actions.Jump.Bindings.Touch.Set(K.TouchPosition);
				const save = decode(input.ExportBindings());
				expectArrayEqual(keysOf(save.Bindings), ["Gameplay/Fly/Gamepad", "Gameplay/Jump/Touch"]);
				expectEqual(save.Bindings["Gameplay/Jump/Touch"].KeyCode, "TouchPosition");
				input.ResetBindings();
				expectEqual(actions.Jump.Bindings.Touch.Instance.KeyCode, K.None);

				const result = input.ImportBindings(
					encode({
						"Gameplay/Fly/Gamepad": { Forward: "ButtonY" },
						"Gameplay/Jump/Touch": { KeyCode: "TouchPosition" },
						"Gameplay/Look/Mouse": { Scale: 0.5 },
						"Gameplay/Jump/Gamepad": { KeyCode: "F" },
						"Gameplay/Crouch/KeyboardAndMouse": { PrimaryModifier: "ButtonL1" },
					}),
				);
				expectArrayEqual(result.Applied, ["Gameplay/Fly/Gamepad", "Gameplay/Jump/Touch"]);
				const reasons = new Map<string, string>();
				for (const skipped of result.Skipped) reasons.set(skipped.Path, skipped.Reason);
				expectEqual(
					reasons.get("Gameplay/Look/Mouse"),
					"Mouse is not a device: a save holds the KeyboardAndMouse, Gamepad, Touch bindings",
				);
				expectEqual(
					reasons.get("Gameplay/Jump/Gamepad"),
					"F is a KeyboardAndMouse key: a Gamepad binding takes gamepad keys",
				);
				expectEqual(
					reasons.get("Gameplay/Crouch/KeyboardAndMouse"),
					"ButtonL1 is a Gamepad key: a KeyboardAndMouse binding takes keyboard and mouse keys",
				);
				expectEqual(actions.Fly.Bindings.Gamepad.Instance.Forward, K.ButtonY);
				expectEqual(actions.Jump.Bindings.Gamepad.Instance.KeyCode, K.ButtonA, "stays default");
			});

			test("an adopted binding with another device's key is warned about and left as it is", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				const pad = new Instance("InputBinding");
				pad.Name = "JumpGamepad";
				pad.KeyCode = K.G;
				pad.Parent = jump;
				context.Parent = folder;
				const input = createTestInput(folder);
				expectEqual(input.Gameplay.Actions.Jump.Bindings.Gamepad.Instance, pad);
				expectEqual(pad.KeyCode, K.G);
				eventually(
					() =>
						warnings.some(
							(message) =>
								contains(message, "Gameplay/Jump/Gamepad") &&
								contains(message, "G is a KeyboardAndMouse key"),
						),
					"a warning naming the binding and the device",
				);
			});

			test("a Manager binding for a device the schema leaves out is that device's binding, not an extra", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				const touch = new Instance("InputBinding");
				touch.Name = "JumpTouch";
				touch.KeyCode = K.TouchPosition;
				touch.Parent = jump;
				context.Parent = folder;
				const input = createTestInput(folder);
				const handle = input.Gameplay.Actions.Jump.Bindings.Touch;
				expectEqual(handle.Instance, touch);
				expectEqual(handle.Get().KeyCode, K.TouchPosition);
				frames(3);
				expectFalse(
					warnings.some((message) => contains(message, "JumpTouch")),
					"no warning about JumpTouch",
				);
				// its defaults are the designer's
				handle.Set(K.TouchPosition);
				handle.Clear();
				handle.Reset();
				expectEqual(touch.KeyCode, K.TouchPosition);
			});

			test("Create twice: a schema that names a device the first left out fills its unbound binding", () => {
				const folder = newFolder();
				const first = InputActions.Create(KEYS_ONLY, { Folder: folder });
				defer(() => first.Destroy());
				const pad = first.DevicesShared.Actions.Jump.Bindings.Gamepad;
				expectEqual(pad.Instance.KeyCode, K.None, "unbound: the first schema leaves it out");
				const second = InputActions.Create(WITH_PAD, { Folder: folder });
				defer(() => second.Destroy());
				expectEqual(second.DevicesShared.Actions.Jump.Bindings.Gamepad.Instance, pad.Instance);
				expectEqual(pad.Instance.KeyCode, K.ButtonA, "the second schema's key");
				// both handles share the new defaults
				pad.Set(K.ButtonB);
				expectEqual(
					decode(first.ExportBindings()).Bindings["DevicesShared/Jump/Gamepad"]?.KeyCode,
					"ButtonB",
				);
				second.DevicesShared.Actions.Jump.Bindings.Gamepad.Reset();
				expectEqual(pad.Instance.KeyCode, K.ButtonA);
				pad.Reset();
				expectEqual(pad.Instance.KeyCode, K.ButtonA, "the first handle's Reset too");
				expectEqual(first.ExportBindings(), '{"Version":1,"Bindings":{}}');
			});

			test("Create twice: a player's rebind of the unbound binding stays; the defaults are the second schema's", () => {
				const folder = newFolder();
				const first = InputActions.Create(KEYS_ONLY, { Folder: folder });
				defer(() => first.Destroy());
				const pad = first.DevicesShared.Actions.Jump.Bindings.Gamepad;
				pad.Set(K.ButtonX);
				const second = InputActions.Create(WITH_PAD, { Folder: folder });
				defer(() => second.Destroy());
				expectEqual(pad.Instance.KeyCode, K.ButtonX, "the rebind stays");
				pad.Reset();
				expectEqual(pad.Instance.KeyCode, K.ButtonA, "back to the second schema's key");
				// and in the other order, the first schema's key stays the default
				const other = newFolder();
				const withPad = InputActions.Create(WITH_PAD, { Folder: other });
				defer(() => withPad.Destroy());
				const keysOnly = InputActions.Create(KEYS_ONLY, { Folder: other });
				defer(() => keysOnly.Destroy());
				const shared = keysOnly.DevicesShared.Actions.Jump.Bindings.Gamepad;
				expectEqual(shared.Instance.KeyCode, K.ButtonA);
				shared.Clear();
				shared.Reset();
				expectEqual(shared.Instance.KeyCode, K.ButtonA);
			});

			test("an unbound binding changes nothing for PreferredBinding (IAS never prefers it)", () => {
				if (getProject() === "touch")
					return skip("the phone prefers touch, which Jump has none of");
				if (UserInputService.GetConnectedGamepads().size() > 0)
					return skip("a gamepad is connected: PreferredInput is Gamepad");
				const input = InputActions.Create(KEYS_ONLY, { Folder: newFolder() });
				defer(() => input.Destroy());
				const jump = input.DevicesShared.Actions.Jump;
				eventually(
					() => jump.GetPreferredBinding() === jump.Bindings.KeyboardAndMouse.Instance,
					`the keyboard's binding (PreferredInput ${UserInputService.PreferredInput.Name}, preferred ${jump.GetPreferredBinding()?.Name})`,
				);
			});

			test("PreferredDevice follows UserInputService.PreferredInput, the TV remote as Gamepad", () => {
				const device = InputActions.PreferredDevice();
				expectEqual(device, deviceFor(UserInputService.PreferredInput));
				if (getProject() === "touch") expectEqual(device, "Touch");
				else if (UserInputService.GetConnectedGamepads().size() === 0)
					expectEqual(device, "KeyboardAndMouse");
				expectEqual(deviceFor(Enum.PreferredInput.MicroGamepad), "Gamepad");
			});

			// Measured with the virtual pad (2026-10-03): plugging a pad in, with no input, switches
			// PreferredInput to Gamepad within 0.3 s, and unplugging switches back. No pad input here,
			// but plugging in is opt-in too (VIRTUAL_PAD=1): every process sees the pad
			test("PreferredDevice reads Gamepad while a pad is plugged in, and the keyboard's again once it is out", () => {
				if (getProject() === "touch")
					return skip("under the simulated phone PreferredInput stays Touch");
				const pad = virtualPad({ Input: false });
				if (typeIs(pad, "string")) return skip(pad);
				if (UserInputService.GetConnectedGamepads().size() > 0)
					return skip("a gamepad is connected already");
				const gamepad = pad.Connect();
				if (gamepad === undefined) return skip("Roblox never listed the virtual pad");
				eventually(
					() => InputActions.PreferredDevice() === "Gamepad",
					"Gamepad once plugged in",
					3,
				);
				pad.Disconnect();
				eventually(
					() => InputActions.PreferredDevice() === "KeyboardAndMouse",
					"the keyboard's once unplugged",
					3,
				);
			});
		});
	}
}
