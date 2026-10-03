import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectTrue,
	fail,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService } from "@rbxts/services";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { frames, newFolder } from "./helpers";
import { isRendering, realInput } from "./virtual";

const K = Enum.KeyCode;

// Hunter, features loop round 4 (the last): 0.7.0's new features after round 3's fixes. The Guide's
// FreeKey recipe and the conflicts' `Slot` on a stick, BindingsChanged across root handles at the
// Server Authority swap, bindings under a computed name with a computed extra name (the type rules
// are in tests/type-rules/hunter-features-4-type-rules.ts), Advanced's conflicts snippet against the
// Guide's, and probes. Keys no player script nor other section takes (CLAUDE.md), in contexts above
// the PlayerModule's and the template other sections leave enabled.

/** The project and the signal mode, for a failure message */
function where() {
	return `${getProject() ?? "unknown project"}, ${expectedSignalBehavior() ?? "unknown"} signals, IsServerAuthority ${InputActions.IsServerAuthority()}`;
}

/** For a failure message when a real key never arrived: a window that renders nothing gets no input */
function renderNote(): string {
	return isRendering() ? "" : " (the window renders nothing: is the display off?)";
}

/** Waits `seconds` of `os.clock` time, yielding */
function waitSeconds(seconds: number) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) RunService.Heartbeat.Wait();
}

/** Waits up to 5 s for what a real key does; fails saying `what` never came, and why it may not have */
function arrives(predicate: () => boolean, what: string) {
	const deadline = os.clock() + 5;
	while (!predicate() && os.clock() < deadline) RunService.Heartbeat.Wait();
	if (!predicate()) fail(`${what} never came${renderNote()}`);
}

/** A counter a gesture's callback adds to */
function counter() {
	const count = { count: 0 };
	return [count, () => count.count++] as const;
}

/** The Guide's schema (recipe 1), the parts its rebind menu (recipe 3) works on */
const GUIDE_SCHEMA = InputActions.Schema({
	Hf4Gameplay: {
		Priority: 3400,
		Actions: {
			Jump: InputActions.Bool({
				KeyboardAndMouse: { Main: K.Space, Alt: {} },
				Gamepad: { Main: K.ButtonA, Alt: {} },
			}),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D },
				Gamepad: K.Thumbstick1,
			}),
			Interact: InputActions.Bool({ KeyboardAndMouse: K.E, Gamepad: K.ButtonX }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: K.C }),
			QuickSave: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.S, PrimaryModifier: K.LeftControl },
			}),
		},
	},
	Hf4Menu: InputActions.Presets.UiNavigation({ Priority: 3500, Sink: true, Enabled: false }),
});

type GuideInput = ReturnType<typeof createGuide>;
type AnyBinding = InputActions.BindingHandle<Enum.InputActionType, InputActions.Device>;

/** The Guide's schema in a fresh folder, `ResetOnFocusLoss` off; destroyed after the test */
function createGuide() {
	const input = InputActions.Create(GUIDE_SCHEMA, { Folder: newFolder(), ResetOnFocusLoss: false });
	defer(() => input.Destroy());
	return input;
}

/**
 * The Guide's FreeKey (recipe 3), as written but for its `warn`s, which are logged instead: after a
 * capture, the other gameplay bindings of the device that share its key lose it; a chord's modifier,
 * and a key that is part of a wider one there (`Wider`), only shown. (The worker updated it with
 * the Guide for HF4-1: the hunter's copy had no `Wider` branch, as the Guide then)
 */
function guideFreeKey(input: GuideInput, binding: AnyBinding, log: string[]) {
	for (const conflict of input.Hf4Gameplay.FindConflicts(binding)) {
		const held = (conflict.Binding.Get() as unknown as Record<string, unknown>)[conflict.Slot];
		const modifier = conflict.Slot === "PrimaryModifier" || conflict.Slot === "SecondaryModifier";
		if (modifier || conflict.Wider) {
			log.push(`${conflict.Path}: shown (Key ${conflict.Key.Name}, Slot ${conflict.Slot} holds ${tostring(held)}${conflict.Wider ? ", Wider" : ""})`);
			continue;
		}
		log.push(`${conflict.Path}: Clear("${conflict.Slot}") (Key ${conflict.Key.Name}, the slot held ${tostring(held)})`);
		conflict.Binding.Clear(conflict.Slot);
	}
}

/**
 * Advanced's conflicts snippet (Rebinding, Conflicts), as written but for its `warn`s: after a
 * capture, the gameplay context's conflicts are cleared, a chord's modifier and a key that is part
 * of a wider one left. (The worker updated it with Advanced for HF4-4 and HF4-1: the hunter's copy
 * asked the root handle, `input.FindConflicts`, as Advanced then, and had no `Wider` branch)
 */
function advancedFreeKey(input: GuideInput, binding: AnyBinding, log: string[]) {
	for (const conflict of input.Hf4Gameplay.FindConflicts(binding)) {
		if (conflict.Slot === "PrimaryModifier" || conflict.Slot === "SecondaryModifier") continue;
		if (conflict.Wider) continue;
		log.push(`${conflict.Path}: Clear("${conflict.Slot}") (Key ${conflict.Key.Name})`);
		conflict.Binding.Clear(conflict.Slot);
	}
}

/** A conflict as text: its path, key, slot and slots, and whether the other side holds the wider key */
function conflictText(conflict: InputActions.BindingConflict) {
	return `${conflict.Path} ${conflict.Key.Name} ${conflict.Slot} [${conflict.Slots.join(",")}]${conflict.Wider ? " wider" : ""}`;
}

let copies = 0;

@Provider({ activeIn: ["testing"] })
export class HunterFeatures4Tests implements OnStart {
	onStart() {
		defineTests("hunter-features-4", () => {
			// HF4-1 (hunter, fixed: a conflict tells with `Wider` that the other binding's KeyCode holds the wider key a shared key is part of, the whole stick or TouchPosition, which clearing frees all of; the Guide's FreeKey, Advanced's snippet, the example and the JSDoc show such a conflict instead of clearing it, and the docs say `Clear(Slot)` frees `Key` alone unless `Wider`): FreeKey (Guide recipe 3, Advanced, the example, the JSDoc) after a gamepad capture of a stick's direction cleared the other binding's whole stick: conflict.Slot held the wider key, not conflict.Key
			test("HF4-1: the Guide's FreeKey after a capture of the left stick's Up for Interact leaves Move the rest of the stick", () => {
				const input = createGuide();
				const { Interact, Move } = input.Hf4Gameplay.Actions;
				// What the Guide's RebindAction gets when the player pushes the left stick up during
				// "press a key or a button for Interact" (API: a Gamepad capture takes "a stick pushed past
				// halfway, as its direction Thumbstick1Up"; a Bool KeyCode takes an Axis key). VirtualInput
				// may send Thumbstick1Up as a key; when it can't, the capture's write is made with Set
				let route = "Set(Thumbstick1Up) in place of the capture";
				const real = realInput();
				if (!typeIs(real, "string")) {
					const result: { settled: boolean; chord?: InputActions.Chord; device?: string } = {
						settled: false,
					};
					const stop = Interact.CaptureChord(
						(chord, device) => {
							result.settled = true;
							result.chord = chord;
							result.device = device;
						},
						{ Cancel: [K.Backspace], Timeout: 3 },
					);
					const [sent] = pcall(() => real.Press(K.Thumbstick1Up));
					if (sent) {
						frames(2);
						real.Release(K.Thumbstick1Up);
					}
					const deadline = os.clock() + 4;
					while (!result.settled && os.clock() < deadline) RunService.Heartbeat.Wait();
					stop();
					if (result.chord?.KeyCode === K.Thumbstick1Up && result.device === "Gamepad")
						route = "a real CaptureChord of the action (VirtualInput's Thumbstick1Up)";
				}
				if (Interact.Bindings.Gamepad.Get().KeyCode !== K.Thumbstick1Up)
					Interact.Bindings.Gamepad.Set(K.Thumbstick1Up);
				frames(1);
				expectEqual(Move.Bindings.Gamepad.Get().KeyCode, K.Thumbstick1, "Move on the left stick before");
				const log = new Array<string>();
				guideFreeKey(input, Interact.Bindings.Gamepad, log);
				const after = Move.Bindings.Gamepad.Get().KeyCode;
				expectTrue(
					after === K.Thumbstick1,
					"Guide (recipe 3): a key that is part of a wider one there (conflict.Wider) is shown, not " +
						"cleared: 'the left stick pushed up for Interact (Thumbstick1Up) also moves Move, which " +
						"holds the whole stick in its KeyCode, and clearing that slot would take all four " +
						"directions'; API (FindConflicts): 'Unless Wider, Binding.Clear(Slot) frees Key alone'. " +
						`Interact's Gamepad binding captured Thumbstick1Up (${route}), then the Guide's FreeKey: ` +
						`${log.join("; ")}. Expected Move to keep the stick, the conflict shown: its Gamepad ` +
						`binding now reads ${after === undefined ? "unbound" : after.Name}, Describe ` +
						`"${Move.Bindings.Gamepad.Describe()}" (${where()})`,
				);
				expectTrue(
					log.size() === 1 && log[0].find("shown", 1, true)[0] !== undefined,
					`the conflict with Move shown: ${log.join("; ")}`,
				);
			});

			// worker, HF4-1: `Wider` marks a conflict whose other binding holds the wider key in its KeyCode (the whole stick, TouchPosition), each way round, and each side of a pair; the narrower side and plain keys never. Clearing the slot of a conflict without it frees the shared key alone
			test("worker, HF4-1: Wider marks the side that holds the wider key: a stick and its directions, a drag or a pinch and a tap", () => {
				const schema = InputActions.Schema({
					Hf4Wider: {
						Priority: 3400,
						Actions: {
							Move: InputActions.Direction2D({ Gamepad: K.Thumbstick1, Touch: K.TouchDelta }),
							Interact: InputActions.Bool({
								KeyboardAndMouse: K.S,
								Gamepad: K.Thumbstick1Up,
								Touch: K.TouchPosition,
							}),
							Throttle: InputActions.Direction1D({
								Gamepad: { Up: K.Thumbstick1Up, Down: K.Thumbstick1Down },
								Touch: K.TouchPinch,
							}),
							Walk: InputActions.Direction2D({ KeyboardAndMouse: { Up: K.W, Down: K.S, Left: K.A, Right: K.D } }),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const context = input.Hf4Wider;
				const { Move, Interact, Throttle } = context.Actions;
				const list = (binding: AnyBinding) => context.FindConflicts(binding).map(conflictText).join("; ");
				const seen = [
					`Interact pad: ${list(Interact.Bindings.Gamepad)}`,
					`Move pad: ${list(Move.Bindings.Gamepad)}`,
					`Throttle pad: ${list(Throttle.Bindings.Gamepad)}`,
					`Move drag: ${list(Move.Bindings.Touch)}`,
					`Interact tap: ${list(Interact.Bindings.Touch)}`,
					`Throttle pinch: ${list(Throttle.Bindings.Touch)}`,
					`Interact S: ${list(Interact.Bindings.KeyboardAndMouse)}`,
				];
				expectEqual(
					seen.join(" | "),
					[
						"Interact pad: Hf4Wider/Move/Gamepad Thumbstick1Up KeyCode [KeyCode] wider; Hf4Wider/Throttle/Gamepad Thumbstick1Up Up [Up]",
						"Move pad: Hf4Wider/Interact/Gamepad Thumbstick1Up KeyCode [KeyCode]; Hf4Wider/Throttle/Gamepad Thumbstick1Up Up [Up,Down]",
						"Throttle pad: Hf4Wider/Interact/Gamepad Thumbstick1Up KeyCode [KeyCode]; Hf4Wider/Move/Gamepad Thumbstick1Up KeyCode [KeyCode] wider",
						"Move drag: Hf4Wider/Interact/Touch TouchDelta KeyCode [KeyCode] wider",
						"Interact tap: Hf4Wider/Move/Touch TouchDelta KeyCode [KeyCode]; Hf4Wider/Throttle/Touch TouchPinch KeyCode [KeyCode]",
						"Throttle pinch: Hf4Wider/Interact/Touch TouchPinch KeyCode [KeyCode] wider",
						"Interact S: Hf4Wider/Walk/KeyboardAndMouse S Down [Down]",
					].join(" | "),
					"API (FindConflicts): Wider is true when the other binding's KeyCode holds the wider key",
				);
				const pairList = context
					.FindConflicts()
					.map((pair) => `${pair.Paths[0]} ${pair.Paths[1]} ${pair.Key.Name} ${pair.Wider[0]} ${pair.Wider[1]}`);
				expectEqual(
					pairList.join(" | "),
					[
						"Hf4Wider/Interact/Gamepad Hf4Wider/Move/Gamepad Thumbstick1Up false true",
						"Hf4Wider/Interact/Gamepad Hf4Wider/Throttle/Gamepad Thumbstick1Up false false",
						"Hf4Wider/Interact/KeyboardAndMouse Hf4Wider/Walk/KeyboardAndMouse S false false",
						"Hf4Wider/Interact/Touch Hf4Wider/Move/Touch TouchDelta true false",
						"Hf4Wider/Interact/Touch Hf4Wider/Throttle/Touch TouchPinch true false",
						"Hf4Wider/Move/Gamepad Hf4Wider/Throttle/Gamepad Thumbstick1Up true false",
					].join(" | "),
					"API (FindConflicts()): Wider, each side in the order of Paths",
				);
				// the other way round: Move's view of Interact, no Wider; clearing that slot frees the
				// shared key alone, and Move keeps its stick
				for (const conflict of context.FindConflicts(Move.Bindings.Gamepad)) {
					if (conflict.Path === "Hf4Wider/Interact/Gamepad") conflict.Binding.Clear(conflict.Slot);
				}
				expectEqual(
					`${Interact.Bindings.Gamepad.Describe()} | ${Move.Bindings.Gamepad.Describe()}`,
					" | Left Stick",
					"Interact's Thumbstick1Up cleared, Move's stick kept",
				);
			});

			// HF4-2 (hunter, fixed: `MoveBindings` adds the stand-in's own handles on a binding it adopts to the swap's `Changed` when the adopted binding reads otherwise than the stand-in's did, and their root handles' BindingsChanged fires once the swap is done): at the Server Authority swap the stand-in's root handle adopted another root handle's bindings on the copy (its rebind, its keys for a device the stand-in's schema left out): what it read changed, and its BindingsChanged didn't fire
			test("HF4-2: the swap onto bindings another root handle has on the copy fires the stand-in's root handle's BindingsChanged when what it reads changes", () => {
				copies++;
				const playerFolder = new Instance("Folder");
				playerFolder.Name = `InputsHf4Swap${copies}`;
				const copy = new Instance("InputContext");
				copy.Name = "Hf4Swap";
				copy.Priority = 3400;
				const copyPoke = new Instance("InputAction");
				copyPoke.Name = "Poke";
				copyPoke.Type = Enum.InputActionType.Bool;
				copyPoke.Parent = copy;
				copy.Parent = playerFolder;
				playerFolder.Parent = Players.LocalPlayer;
				defer(() => playerFolder.Destroy());
				const options = {
					Folder: newFolder(),
					PlayerFolderName: playerFolder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				};
				// the HUD's schema needs an action the copy lacks yet: it waits on a stand-in. It leaves
				// the gamepad out
				const hud = InputActions.Create(
					InputActions.Schema({
						Hf4Swap: {
							ServerAuthority: true,
							Priority: 3400,
							Actions: {
								Poke: InputActions.Bool({ KeyboardAndMouse: K.N }),
								Spare: InputActions.Bool({ KeyboardAndMouse: K.J }),
							},
						},
					}),
					options,
				);
				defer(() => hud.Destroy());
				expectTrue(!hud.Hf4Swap.IsLinkedToServer(), "the HUD's schema on its stand-in");
				// the menu's schema is on the copy at once, and names the gamepad
				const menu = InputActions.Create(
					InputActions.Schema({
						Hf4Swap: {
							ServerAuthority: true,
							Priority: 3400,
							Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N, Gamepad: K.ButtonY }) },
						},
					}),
					options,
				);
				defer(() => menu.Destroy());
				expectTrue(menu.Hf4Swap.IsLinkedToServer(), "the menu's schema on the copy at once");
				menu.Hf4Swap.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.M);
				frames(2);
				const hudPoke = hud.Hf4Swap.Actions.Poke;
				const read = () => `KeyboardAndMouse "${hudPoke.Describe("KeyboardAndMouse")}", Gamepad "${hudPoke.Describe("Gamepad")}"`;
				const before = read();
				const heard = new Array<string>();
				const connection = hud.BindingsChanged.Connect((path) => heard.push(path));
				defer(() => connection.Disconnect());
				const spare = new Instance("InputAction");
				spare.Name = "Spare";
				spare.Type = Enum.InputActionType.Bool;
				spare.Parent = copy;
				eventually(() => hud.Hf4Swap.IsLinkedToServer(), "the swap");
				frames(3);
				const after = read();
				expectEqual(hudPoke.Instance, menu.Hf4Swap.Actions.Poke.Instance, "one action on the copy");
				expectTrue(before !== after, `the swap changes what the HUD reads: before ${before}, after ${after}`);
				const sorted = [...heard];
				sorted.sort();
				expectTrue(
					sorted.size() === 2 &&
						sorted[0] === "Hf4Swap/Poke/Gamepad" &&
						sorted[1] === "Hf4Swap/Poke/KeyboardAndMouse",
					"API (Root handle): BindingsChanged 'fires on every root handle that has the binding, with " +
						"its own path: a change made through another root handle on the same folder, or a later " +
						"Create filling the binding, included'; EdgeCases: 'A rebind ... through one root handle " +
						"changes what the others read (Get, Describe), so their BindingsChanged fires too ... A " +
						"HUD's hint refreshed on its own root handle's BindingsChanged follows a menu's rebinds " +
						"made through another'. A HUD's root handle on a stand-in (its schema has an action the " +
						"copy gained later), a menu's root handle on the copy that rebound Poke's keys to M and " +
						`names the gamepad (ButtonY): at the swap the HUD's Poke went from ${before} to ${after}, ` +
						`and the HUD's BindingsChanged heard [${heard.join(", ")}]; expected both paths, as for ` +
						`the menu's rebind or a later Create's fill (${where()})`,
				);
			});

			// worker, HF4-2: the swap tells each root handle of the bindings whose reading changed for it, once, and only those: the stand-in's own rebind carried onto the shared binding reads as before for it (the copy's root handle hears it, HF3-5), the copy's rebind is news to the stand-in's root handle, and an action both read alike is heard by neither
			test("worker, HF4-2: at the swap each root handle hears the bindings whose reading changed for it, and only those", () => {
				copies++;
				const playerFolder = new Instance("Folder");
				playerFolder.Name = `InputsHf4Quiet${copies}`;
				const copy = new Instance("InputContext");
				copy.Name = "Hf4Quiet";
				copy.Priority = 3400;
				for (const name of ["Poke", "Prod"]) {
					const action = new Instance("InputAction");
					action.Name = name;
					action.Type = Enum.InputActionType.Bool;
					action.Parent = copy;
				}
				copy.Parent = playerFolder;
				playerFolder.Parent = Players.LocalPlayer;
				defer(() => playerFolder.Destroy());
				const options = {
					Folder: newFolder(),
					PlayerFolderName: playerFolder.Name,
					Timeout: 1000,
					ResetOnFocusLoss: false,
				};
				const actions = {
					Poke: InputActions.Bool({ KeyboardAndMouse: K.N, Gamepad: K.ButtonY }),
					Prod: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonX }),
				};
				// the HUD's schema needs an action the copy lacks yet: it waits on a stand-in
				const hud = InputActions.Create(
					InputActions.Schema({
						Hf4Quiet: {
							ServerAuthority: true,
							Priority: 3400,
							Actions: { ...actions, Spare: InputActions.Bool({ KeyboardAndMouse: K.U }) },
						},
					}),
					options,
				);
				defer(() => hud.Destroy());
				const menu = InputActions.Create(
					InputActions.Schema({ Hf4Quiet: { ServerAuthority: true, Priority: 3400, Actions: actions } }),
					options,
				);
				defer(() => menu.Destroy());
				expectTrue(
					!hud.Hf4Quiet.IsLinkedToServer() && menu.Hf4Quiet.IsLinkedToServer(),
					"the HUD on its stand-in, the menu on the copy",
				);
				// the HUD rebinds Poke's keyboard key on its stand-in, the menu Poke's gamepad key on the
				// copy; Prod reads alike on both
				hud.Hf4Quiet.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.M);
				menu.Hf4Quiet.Actions.Poke.Bindings.Gamepad.Set(K.ButtonB);
				frames(2);
				const heard = { hud: new Array<string>(), menu: new Array<string>() };
				const connections = [
					hud.BindingsChanged.Connect((path) => heard.hud.push(path)),
					menu.BindingsChanged.Connect((path) => heard.menu.push(path)),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				const spare = new Instance("InputAction");
				spare.Name = "Spare";
				spare.Type = Enum.InputActionType.Bool;
				spare.Parent = copy;
				eventually(() => hud.Hf4Quiet.IsLinkedToServer(), "the swap");
				frames(3);
				const read = (input: typeof menu) =>
					`${input.Hf4Quiet.Actions.Poke.Describe("KeyboardAndMouse")} ${input.Hf4Quiet.Actions.Poke.Describe("Gamepad")}`;
				expectEqual(`${read(hud)} | ${read(menu)}`, "M B | M B", "both read the shared bindings");
				expectEqual(
					`HUD [${heard.hud.join(", ")}], menu [${heard.menu.join(", ")}]`,
					"HUD [Hf4Quiet/Poke/Gamepad], menu [Hf4Quiet/Poke/KeyboardAndMouse]",
					`each root handle hears what changed for it, once (${where()})`,
				);
			});

			// evidence for HF4-3 (compile time, hunter-features-4-type-rules.ts; fixed there: the types refuse each under a computed name with a computed extra name now): the values the types accepted there are refused by Schema under every name
			test("HF4-3 evidence: Schema refuses, under every name, the computed-extra-name bindings the types accepted", () => {
				const builders = {
					Bool: InputActions.Bool,
					Direction1D: InputActions.Direction1D,
				} as unknown as Record<string, (bindings: unknown) => unknown>;
				// the extra's name is computed in the type rules; any name Schema takes stands for it here
				const values: Array<[string, string, unknown]> = [
					["Bool", "{ Main: E, <extra>: { KeyCode: Q, Typo: 1 } }", { Main: K.E, Alt: { KeyCode: K.Q, Typo: 1 } }],
					["Bool", "{ Main: E, <extra>: { KeyCode: Q, Up: W } }", { Main: K.E, Alt: { KeyCode: K.Q, Up: K.W } }],
					["Bool", "{ Main: E, <extra>: { KeyCode: Q, ResponseCurve: 2 } }", { Main: K.E, Alt: { KeyCode: K.Q, ResponseCurve: 2 } }],
					["Bool", "{ Main: E, <extra>: { KeyCode: Q, Scale: 2 } }", { Main: K.E, Alt: { KeyCode: K.Q, Scale: 2 } }],
					["Bool", "{ Main: ButtonA, <extra>: { KeyCode: ButtonB, Typo: true } }", { Main: K.ButtonA, Alt: { KeyCode: K.ButtonB, Typo: true } }],
					["Direction1D", "{ Main: E, <extra>: { KeyCode: Q, Vector2Scale } }", { Main: K.E, Alt: { KeyCode: K.Q, Vector2Scale: new Vector2(1, 1) } }],
				];
				const accepted = new Array<string>();
				for (const [actionType, what, value] of values) {
					for (const name of ["KeyboardAndMouse", "Gamepad", "Touch", "Other"]) {
						const [ok] = pcall(() =>
							InputActions.Schema({
								Hf4Evidence: { Actions: { Poke: builders[actionType]({ [name]: value }) } },
							} as never),
						);
						if (ok) accepted.push(`${actionType} ${what} under ${name}`);
					}
				}
				expectArrayEqual(accepted, [], "Schema should refuse each value under every name");
			});

			// HF4-4 (hunter, docs, fixed: Advanced's snippet asks the gameplay context's handle, `Input.Gameplay.FindConflicts`, and says when the root handle is right: contexts that can be on together, or listing every clash; QuickStart's line and the example ask the context handle too): Advanced's conflicts snippet (on the root handle) run on the Guide's schema cleared the menu preset's Accept when Jump's gamepad key was captured as ButtonA, where the Guide's FreeKey (on the context handle) leaves it, as the Guide says it must
			test("HF4-4: Advanced's conflicts snippet, on the Guide's schema, leaves the menu's Accept on ButtonA when Jump captures ButtonA", () => {
				const input = createGuide();
				const { Jump } = input.Hf4Gameplay.Actions;
				const accept = input.Hf4Menu.Actions.Accept;
				// Jump's gamepad key captured as ButtonA (its default: the player picked it again), with a
				// real capture where VirtualInput's ButtonA (a key) arrives, else as it stands
				let route = "no capture: Jump's Gamepad binding already ButtonA";
				const real = realInput();
				if (!typeIs(real, "string")) {
					const result: { key?: Enum.KeyCode; device?: string; settled: boolean } = { settled: false };
					const stop = Jump.Capture(
						(key, device) => {
							result.settled = true;
							result.key = key;
							result.device = device;
						},
						{ Cancel: [K.Backspace] },
					);
					const [sent] = pcall(() => real.Tap(K.ButtonA));
					const deadline = os.clock() + 3;
					while (sent && !result.settled && os.clock() < deadline) RunService.Heartbeat.Wait();
					stop();
					if (result.key === K.ButtonA && result.device === "Gamepad")
						route = "a real Capture of the action (VirtualInput's ButtonA)";
				}
				expectEqual(Jump.Bindings.Gamepad.Get().KeyCode, K.ButtonA, "Jump on ButtonA");
				const guideLog = new Array<string>();
				guideFreeKey(input, Jump.Bindings.Gamepad, guideLog);
				const guideAccept = accept.Bindings.Gamepad.Get().KeyCode;
				const advancedLog = new Array<string>();
				advancedFreeKey(input, Jump.Bindings.Gamepad, advancedLog);
				const advancedAccept = accept.Bindings.Gamepad.Get().KeyCode;
				expectEqual(guideAccept, K.ButtonA, "the Guide's FreeKey leaves the menu's Accept");
				expectTrue(
					advancedAccept === K.ButtonA,
					"Guide (recipe 3): 'Input.Gameplay.FindConflicts looks in that context only, so the " +
						"menu's Accept on ButtonA is no conflict for Jump: the two contexts are never on " +
						"together'; Advanced (Conflicts) asks the context handle too: " +
						"'for (const conflict of Input.Gameplay.FindConflicts(jump.Bindings[device])) ... " +
						"conflict.Binding.Clear(conflict.Slot)'. On the Guide's schema (its Menu preset in the " +
						`same root handle), Jump's gamepad key captured as ButtonA (${route}): the Guide's ` +
						`FreeKey [${guideLog.join("; ")}] leaves Accept on ButtonA; Advanced's [${advancedLog.join("; ")}] ` +
						`leaves it ${advancedAccept === undefined ? "unbound" : advancedAccept.Name} (${where()})`,
				);
			});

			// worker, HF4-4: the root handle looks in every context, the context handle in its own (Advanced: the root handle is right for contexts that can be on together, or to list every clash): Jump's ButtonA clashes with the menu's Accept on the root handle only
			test("worker, HF4-4: Jump on ButtonA: the root handle lists the menu's Accept, the gameplay context's handle doesn't", () => {
				const input = createGuide();
				const pad = input.Hf4Gameplay.Actions.Jump.Bindings.Gamepad;
				const paths = (conflicts: InputActions.BindingConflict[]) => conflicts.map((conflict) => conflict.Path);
				const root = paths(input.FindConflicts(pad));
				const context = paths(input.Hf4Gameplay.FindConflicts(pad));
				expectTrue(
					root.includes("Hf4Menu/Accept/Gamepad") && context.isEmpty(),
					`root handle [${root.join(", ")}], gameplay context's handle [${context.join(", ")}]`,
				);
			});

			// probe: the Guide's FreeKey in the cases the Guide names: S captured for Jump takes Move's Down alone (W, A, D stay); Ctrl captured for Crouch is only shown on QuickSave, which keeps Ctrl+S
			// (its first run, both steps on one root handle, found Crouch's Ctrl shared with nothing: S to Jump had taken S from QuickSave's Ctrl+S, which FreeKey clears as the KeyCode it shares, leaving QuickSave a modifier without a key, Describe ""; the recipe's own words, "lose it", so each case runs on its own root handle now)
			test("probe: the Guide's FreeKey in the cases it names: S to Jump, Ctrl to Crouch", () => {
				const input = createGuide();
				const { Jump, Move } = input.Hf4Gameplay.Actions;
				Jump.Bindings.KeyboardAndMouse.Set(K.S);
				const log = new Array<string>();
				guideFreeKey(input, Jump.Bindings.KeyboardAndMouse, log);
				expectEqual(Move.Bindings.KeyboardAndMouse.Describe(), "W / A / D", `Move keeps W, A, D: ${log.join("; ")}`);
				const fresh = createGuide();
				const { Crouch, QuickSave } = fresh.Hf4Gameplay.Actions;
				Crouch.Bindings.KeyboardAndMouse.Set(K.LeftControl);
				const crouchLog = new Array<string>();
				guideFreeKey(fresh, Crouch.Bindings.KeyboardAndMouse, crouchLog);
				expectTrue(
					crouchLog.size() === 1 && crouchLog[0].find("shown", 1, true)[0] !== undefined,
					`Ctrl for Crouch: QuickSave's modifier shown: ${crouchLog.join("; ")}`,
				);
				expectEqual(QuickSave.Bindings.KeyboardAndMouse.Get().PrimaryModifier, K.LeftControl, "QuickSave keeps Ctrl");
			});

			// probe: BindingsChanged across root handles: a context handle's import and a root handle's ResetBindings reach the other root handle with its own paths; an extra only one root handle has stays out of the other's events
			test("probe: BindingsChanged across root handles: a context's import, ResetBindings, an extra only one has", () => {
				const withExtra = InputActions.Schema({
					Hf4Shared: {
						Priority: 3400,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: K.J } }) },
					},
				});
				const plain = InputActions.Schema({
					Hf4Shared: { Priority: 3400, Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) } },
				});
				const folder = newFolder();
				const a = InputActions.Create(withExtra, { Folder: folder, ResetOnFocusLoss: false });
				defer(() => a.Destroy());
				const b = InputActions.Create(plain, { Folder: folder, ResetOnFocusLoss: false });
				defer(() => b.Destroy());
				const heard = { a: new Array<string>(), b: new Array<string>() };
				const connections = [
					a.BindingsChanged.Connect((path) => heard.a.push(path)),
					b.BindingsChanged.Connect((path) => heard.b.push(path)),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				const read = () => `a [${heard.a.join(", ")}], b [${heard.b.join(", ")}]`;
				const MAIN = "Hf4Shared/Poke/KeyboardAndMouse";
				const ALT = "Hf4Shared/Poke/KeyboardAndMouse/Alt";
				a.Hf4Shared.ImportBindings(
					`{"Version":1,"Bindings":{"${MAIN}":{"KeyCode":"M"},"${ALT}":{"KeyCode":"U"}}}`,
				);
				frames(2);
				const sortedA = [...heard.a];
				sortedA.sort();
				expectEqual(`${sortedA.join(", ")} | ${heard.b.join(", ")}`, `${MAIN}, ${ALT} | ${MAIN}`, `the context's import: ${read()}`);
				expectEqual(b.Hf4Shared.Actions.Poke.Describe("KeyboardAndMouse"), "M");
				heard.a.clear();
				heard.b.clear();
				b.ResetBindings();
				frames(2);
				expectEqual(read(), `a [${MAIN}], b [${MAIN}]`, "b's ResetBindings: Main back to N for both, Alt left");
				expectEqual(a.Hf4Shared.Actions.Poke.Bindings.KeyboardAndMouse.Alt.Describe(), "U", "the extra b doesn't have");
				heard.a.clear();
				heard.b.clear();
				a.ResetBindings();
				frames(2);
				expectEqual(read(), `a [${ALT}], b []`, "a's ResetBindings: only the extra changed");
			});

			// probe: a key change on a binding other than the one a real key holds (another device's unbound binding filled, an unbound extra filled, the held binding's modifier): the package marks a reset; does IAS make one, or is the player's later release taken for it (swallowed)?
			test("probe: a key change on another binding of an action a real key holds: IAS's release, or the player's swallowed", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					Hf4Other: {
						Priority: 3400,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: {} } }) },
					},
				});
				const make = () => InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				type Poke = ReturnType<typeof make>["Hf4Other"]["Actions"]["Poke"];
				const changes: Array<[string, (poke: Poke) => void]> = [
					["the unbound Gamepad binding given ButtonY", (poke) => poke.Bindings.Gamepad.Set(K.ButtonY)],
					["the unbound Touch binding given TouchPosition", (poke) => poke.Bindings.Touch.Set(K.TouchPosition)],
					["the unbound extra Alt given J", (poke) => poke.Bindings.KeyboardAndMouse.Alt.Set(K.J)],
					["the held binding given a PrimaryModifier, LeftControl", (poke) =>
						poke.Bindings.KeyboardAndMouse.Set({ PrimaryModifier: K.LeftControl })],
				];
				const results = new Array<string>();
				let ok = true;
				for (const [what, change] of changes) {
					const input = make();
					defer(() => input.Destroy());
					const poke = input.Hf4Other.Actions.Poke;
					const edges = { pressed: 0, released: 0 };
					const log = new Array<string>();
					const connections = [
						poke.Pressed.Connect(() => edges.pressed++),
						poke.Released.Connect(() => edges.released++),
						poke.Instance.Pressed.Connect(() => log.push("p")),
						poke.Instance.Released.Connect(() => log.push("r")),
					];
					const [taps, onTap] = counter();
					const [longs, onLong] = counter();
					poke.OnTap(onTap, { MaxDuration: 5 });
					poke.OnLongPress(onLong, { Duration: 0.0001 });
					real.Press(K.N);
					arrives(() => edges.pressed === 1, `N's press (${what})`);
					waitSeconds(0.1);
					log.push("|change");
					change(poke);
					frames(4);
					waitSeconds(0.1);
					const atChange = edges.released;
					log.push("|let go");
					real.Release(K.N);
					frames(4);
					waitSeconds(0.1);
					const result = `${what}: handle released ${atChange} at the change, ${edges.released} after N let go; OnTap ${taps.count}, OnLongPress ${longs.count} (IAS: ${log.join(" ")})`;
					results.push(result);
					// IAS released at the change (a reset: nothing completes), or it didn't and the player's
					// release completes the tap and the long press
					if (!(atChange === 1 ? taps.count === 0 && longs.count === 0 : taps.count === 1 && longs.count === 1))
						ok = false;
					connections.forEach((connection) => connection.Disconnect());
					input.Destroy();
					frames(2);
				}
				expectTrue(
					ok,
					"EdgeCases (Gestures and releases the player didn't make): the package's resets are 'a " +
						"rebind or a binding added while held'; a release IAS doesn't make for it is the " +
						"player's. A real N held, then a key change on another binding of its action: " +
						`${results.join("; ")} (${where()})${real.FocusNote()}`,
				);
			});

			// probe: gestures with a device's extra key (0.7.0): a tap on the extra is a tap; a rebind of the extra while the main key holds the action ends the press as a reset; the next presses of either key are taps again (round 3's rule: the reset's release found the action at rest)
			test("probe: gestures with an extra key: taps on either key, a rebind of the extra while the main key holds", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const schema = InputActions.Schema({
					Hf4ExtraGestures: {
						Priority: 3400,
						Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: K.J } }) },
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const poke = input.Hf4ExtraGestures.Actions.Poke;
				const edges = { pressed: 0, released: 0 };
				const connections = [
					poke.Pressed.Connect(() => edges.pressed++),
					poke.Released.Connect(() => edges.released++),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				const [taps, onTap] = counter();
				const [longs, onLong] = counter();
				poke.OnTap(onTap, { MaxDuration: 5 });
				poke.OnLongPress(onLong, { Duration: 0.0001 });
				const steps = new Array<string>();
				const note = (what: string) => steps.push(`${what}: taps ${taps.count}, long presses ${longs.count}`);
				real.Tap(K.J);
				arrives(() => edges.released === 1, "the extra key's tap");
				frames(3);
				note("J tapped");
				real.Press(K.N);
				arrives(() => edges.pressed === 2, "the main key's press");
				waitSeconds(0.1);
				poke.Bindings.KeyboardAndMouse.Alt.Set(K.K);
				arrives(() => edges.released === 2, "the rebind's release");
				real.Release(K.N);
				frames(4);
				note("N held, the extra rebound to K, N let go");
				real.Tap(K.N);
				arrives(() => edges.released === 3, "N's tap");
				frames(3);
				note("N tapped");
				real.Tap(K.K);
				arrives(() => edges.released === 4, "K's tap");
				frames(3);
				note("K tapped");
				expectEqual(
					steps.join("; "),
					"J tapped: taps 1, long presses 1; N held, the extra rebound to K, N let go: taps 1, " +
						"long presses 1; N tapped: taps 2, long presses 2; K tapped: taps 3, long presses 3",
					`(${where()})${real.FocusNote()}`,
				);
			});
		});
	}
}
