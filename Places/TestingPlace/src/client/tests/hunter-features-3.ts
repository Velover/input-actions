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
import { Players, RunService, UserInputService } from "@rbxts/services";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { frames, newFolder } from "./helpers";
import { RealInput, emptyPoint, isRendering, realInput } from "./virtual";

const K = Enum.KeyCode;

// Hunter, features loop round 3 (0.7.0's usability features after round 2's fixes: the gesture
// reset rule by sequence numbers, MarkReset only for an action IAS shows held, FinishLink's reset;
// AnyNameBindingSpec per device). Keys no player script nor other section takes (CLAUDE.md), in a
// context above the PlayerModule's and the template other sections leave enabled.

const GESTURE_SCHEMA = InputActions.Schema({
	Hf3Gestures: {
		Priority: 3300,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
	},
});

/** The same context as a Server Authority one, for a copy under the player (`saCopy`) */
const SA_SCHEMA = InputActions.Schema({
	Hf3Sa: {
		ServerAuthority: true,
		Priority: 3300,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
	},
});

/** The gesture schema in a fresh folder, `ResetOnFocusLoss` off; destroyed after the test */
function createGestures(folder: Instance = newFolder()) {
	const input = InputActions.Create(GESTURE_SCHEMA, { Folder: folder, ResetOnFocusLoss: false });
	defer(() => input.Destroy());
	return input;
}

let copies = 0;

/**
 * `SA_SCHEMA` on a copy of its context made under the player, as the server's copy is (the gestures
 * section's swap test and hunter-features' HF-1b play it so): under `authority` IAS treats it as the
 * server's copy, a Server Authority copy (its state moves on simulation steps, a rebind or an added
 * binding presses a held action again, the package fires release pairs); in the other projects it is
 * a local context. `ResetOnFocusLoss` off; destroyed after the test
 */
function saCopy() {
	copies++;
	const playerFolder = new Instance("Folder");
	playerFolder.Name = `InputsHf3Copy${copies}`;
	const copy = new Instance("InputContext");
	copy.Name = "Hf3Sa";
	copy.Priority = 3300;
	const action = new Instance("InputAction");
	action.Name = "Poke";
	action.Type = Enum.InputActionType.Bool;
	action.Parent = copy;
	copy.Parent = playerFolder;
	playerFolder.Parent = Players.LocalPlayer;
	defer(() => playerFolder.Destroy());
	const input = InputActions.Create(SA_SCHEMA, {
		Folder: newFolder(),
		PlayerFolderName: playerFolder.Name,
		Timeout: 1000,
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	expectTrue(input.Hf3Sa.IsLinkedToServer(), "on the copy at once");
	expectTrue(input.Hf3Sa.Actions.Poke.Instance.IsDescendantOf(Players.LocalPlayer), "under the player");
	return input;
}

/** Waits `seconds` of `os.clock` time, yielding */
function waitSeconds(seconds: number) {
	const deadline = os.clock() + seconds;
	while (os.clock() < deadline) RunService.Heartbeat.Wait();
}

/** A handle's Pressed and Released until the test ends: counts, and the order they came in (P, R) */
function edges(action: InputActions.BoolAction) {
	const pressed = { count: 0 };
	const released = { count: 0 };
	const order = new Array<string>();
	const connections = [
		action.Pressed.Connect(() => {
			pressed.count++;
			order.push("P");
		}),
		action.Released.Connect(() => {
			released.count++;
			order.push("R");
		}),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return { Pressed: pressed, Released: released, Order: order };
}

/** IAS's own Pressed and Released on an InputAction (p, r), with the test's marks between them */
function iasLog(action: InputAction) {
	const log = new Array<string>();
	const connections = [
		action.Pressed.Connect(() => log.push("p")),
		action.Released.Connect(() => log.push("r")),
	];
	defer(() => connections.forEach((connection) => connection.Disconnect()));
	return log;
}

/** A counter a gesture's callback adds to */
function counter() {
	const count = { count: 0 };
	return [count, () => count.count++] as const;
}

/** The project and the signal mode, for a failure message */
function where() {
	return `${getProject() ?? "unknown project"}, ${expectedSignalBehavior() ?? "unknown"} signals, IsServerAuthority ${InputActions.IsServerAuthority()}`;
}

/** For a failure message when a real key never arrived: a window that renders nothing gets no input */
function renderNote(): string {
	return isRendering() ? "" : " (the window renders nothing: is the display off?)";
}

/** Waits up to 5 s for what a real key does; fails saying `what` never came, and why it may not have */
function arrives(predicate: () => boolean, what: string) {
	const deadline = os.clock() + 5;
	while (!predicate() && os.clock() < deadline) RunService.Heartbeat.Wait();
	if (!predicate()) fail(`${what} never came${renderNote()}`);
}

/** Lets every edge on its way land: under `authority` a copy's state moves on simulation steps */
function settle() {
	frames(6);
	waitSeconds(0.25);
	frames(4);
}

/** Every gesture a release could wrongly complete, counted: tap, double tap, long press */
function watchGestures(poke: InputActions.BoolAction) {
	const [taps, onTap] = counter();
	const [doubles, onDouble] = counter();
	const longs = new Array<number>();
	poke.OnTap(onTap, { MaxDuration: 5 });
	poke.OnDoubleTap(onDouble, { Window: 5, MaxDuration: 5 });
	poke.OnLongPress((heldFor) => longs.push(heldFor), { Duration: 0.0001 });
	return {
		Taps: taps,
		Doubles: doubles,
		Longs: longs,
		Text: () => `OnTap ${taps.count}, OnDoubleTap ${doubles.count}, OnLongPress ${longs.size()}`,
	};
}

const RESET_PROMISE =
	"'A release the player didn't make ends a gesture without completing it: ... a rebind or a " +
	"binding added while it is held (IAS resets the action) ... No tap, double tap or long press " +
	"comes of it' (Advanced, Gestures)";

@Provider({ activeIn: ["testing"] })
export class HunterFeatures3Tests implements OnStart {
	onStart() {
		defineTests("hunter-features-3", () => {
			// HF3-1 (hunter, fixed: one rule for a reset's release, the package reset the action while IAS showed it held, after the handle's previous release; whether the action is live as the release arrives no longer counts, and every disable the package makes is marked): under Immediate signals a gesture on one root handle that turns the context off (or a Released listener that does) made another root handle's gestures on the same action take the player's release for a reset's
			test("HF3-1: two root handles on one action: one's tap that turns the context off leaves the other's tap", () => {
				const folder = newFolder();
				const first = createGestures(folder);
				const second = createGestures(folder);
				const pokeA = first.Hf3Gestures.Actions.Poke;
				const pokeB = second.Hf3Gestures.Actions.Poke;
				expectEqual(pokeA.Instance, pokeB.Instance, "one action for both root handles");
				const countsA = edges(pokeA);
				const countsB = edges(pokeB);
				const results = new Array<string>();

				// 1. each root handle's OnTap callback turns the context off (a tap that opens a menu)
				const taps = { A: 0, B: 0 };
				const stopA = pokeA.OnTap(
					() => {
						taps.A++;
						first.Hf3Gestures.SetEnabled(false);
					},
					{ MaxDuration: 5 },
				);
				const stopB = pokeB.OnTap(
					() => {
						taps.B++;
						second.Hf3Gestures.SetEnabled(false);
					},
					{ MaxDuration: 5 },
				);
				pokeA.Fire(true);
				eventually(() => countsA.Pressed.count === 1 && countsB.Pressed.count === 1, "the press");
				frames(2);
				pokeA.Fire(false);
				eventually(() => countsA.Released.count === 1 && countsB.Released.count === 1, "the release");
				frames(3);
				results.push(`gesture callbacks: OnTap A ${taps.A}, B ${taps.B}`);
				const callbacksOk = taps.A === 1 && taps.B === 1;
				stopA();
				stopB();
				first.Hf3Gestures.SetEnabled(true);
				second.Hf3Gestures.SetEnabled(true);
				frames(2);

				// 2. each root handle's Released listener turns the context off; plain taps on both
				const tapsAfter = { A: 0, B: 0 };
				pokeA.OnTap(() => tapsAfter.A++, { MaxDuration: 5 });
				pokeB.OnTap(() => tapsAfter.B++, { MaxDuration: 5 });
				const listeners = [
					pokeA.Released.Connect(() => first.Hf3Gestures.SetEnabled(false)),
					pokeB.Released.Connect(() => second.Hf3Gestures.SetEnabled(false)),
				];
				defer(() => listeners.forEach((connection) => connection.Disconnect()));
				pokeA.Fire(true);
				eventually(() => countsA.Pressed.count === 2 && countsB.Pressed.count === 2, "the second press");
				frames(2);
				pokeA.Fire(false);
				eventually(() => countsA.Released.count === 2 && countsB.Released.count === 2, "the second release");
				frames(3);
				results.push(`Released listeners: OnTap A ${tapsAfter.A}, B ${tapsAfter.B}`);
				const listenersOk = tapsAfter.A === 1 && tapsAfter.B === 1;
				first.Hf3Gestures.SetEnabled(true);
				second.Hf3Gestures.SetEnabled(true);

				expectTrue(
					callbacksOk && listenersOk,
					"'Several gestures on one action are independent: each sees every press, and each " +
						"release the same way ... A gesture's callback that turns the context off (a tap that " +
						"opens a menu ...) changes nothing for the other gestures on that release: it was the " +
						"player's' (Advanced, Gestures); two root handles made by Create on one folder (one " +
						"action), Fire(true) then Fire(false) frames later, each handle with an OnTap: expected " +
						`one tap on each; got ${results.join("; ")} (${where()}): the root handle whose listeners ` +
						"ran second found the context off as the release reached it and took it for a reset's",
				);
			});

			// HF3-2 (hunter, fixed as HF3-1: the context or the action turned off once the action was at rest marks nothing, and the release is the player's whether the context is on or off as it arrives): the player's release, then the context turned off (and left off) in the same frame: under Deferred signals the release reached the handle with the context off and counted as a reset's (no tap); under Immediate it was the player's (a tap)
			test("HF3-2: the player's release, then the context (or the action) turned off in its frame: a tap, as under Immediate signals", () => {
				const results = new Array<string>();
				let ok = true;
				for (const how of ["the context's SetEnabled(false)", "the action's SetEnabled(false)"]) {
					const input = createGestures();
					const context = input.Hf3Gestures;
					const poke = context.Actions.Poke;
					const counts = edges(poke);
					const watched = watchGestures(poke);
					poke.Fire(true);
					eventually(() => counts.Pressed.count === 1, "the press");
					frames(2);
					// let go, and in the same frame the gameplay turned off (the action at rest already)
					poke.Fire(false);
					if (how === "the context's SetEnabled(false)") context.SetEnabled(false);
					else poke.SetEnabled(false);
					eventually(() => counts.Released.count === 1, "the release");
					frames(3);
					results.push(`${how}: ${watched.Text()} (edges ${counts.Order.join("")})`);
					if (watched.Taps.count !== 1 || watched.Longs.size() !== 1) ok = false;
					input.Destroy();
				}
				expectTrue(
					ok,
					"EdgeCases (Gestures and releases the player didn't make): 'A reset of an action that " +
						"isn't held releases nothing and changes nothing: a key let go of, then the context " +
						"turned off and on in the same frame, is the player's release (a tap), as under " +
						"Immediate signals'; Fire(false), then in the same frame the gameplay turned off (and " +
						"left off), which found the action at rest: expected a tap and a long press as under " +
						`Immediate signals; got ${results.join("; ")} (${where()})`,
				);
			});

			// worker, HF3-1/HF3-2: the one rule's boundary, as documented. A context turned off through its handle while held is a reset (the gestures section tests it); one whose Enabled is written on the instance, around the package, marks nothing, and its release is the player's
			test("worker, HF3-1: a context turned off around the package (its instance's Enabled) is no reset the gestures know of, as documented", () => {
				const input = createGestures();
				const context = input.Hf3Gestures;
				const poke = context.Actions.Poke;
				const counts = edges(poke);
				const watched = watchGestures(poke);
				defer(() => {
					context.Instance.Enabled = true;
					poke.Fire(false);
				});
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1, "the press");
				frames(2);
				context.Instance.Enabled = false;
				eventually(() => counts.Released.count === 1, "the release the disable makes");
				frames(3);
				expectTrue(
					watched.Taps.count === 1 && watched.Longs.size() === 1,
					"EdgeCases (Gestures and releases the player didn't make): 'Turn contexts and actions " +
						"off through their handles: an Enabled written on the instance, or by another script, " +
						"resets the action without the package knowing, and its release counts as the " +
						`player's'; Fire(true), then the context instance's Enabled = false: ${watched.Text()} ` +
						`(edges ${counts.Order.join("")}; ${where()})`,
				);
			});

			// probe (passed in every project, authority included): a rebind while a Fire holds the action on the copy under the player
			// worker: in the worker's first test:all it failed under authority (OnTap 1, OnLongPress 1; IAS "p |set r p r": the reset's release, the client's state pressed again, the pair's release, apart by timing), the first release using both marks; fixed: only a release that finds the action at rest uses marks up (EmitReleased)
			test("probe: a Server Authority copy: a rebind while a Fire holds the action completes no gesture", () => {
				const input = saCopy();
				const poke = input.Hf3Sa.Actions.Poke;
				const counts = edges(poke);
				const log = iasLog(poke.Instance);
				const watched = watchGestures(poke);
				// <Action>Script made first, at rest
				poke.Fire(false);
				frames(2);
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1 && poke.IsPressed(), "the press");
				waitSeconds(0.1);
				log.push("|set");
				poke.Bindings.KeyboardAndMouse.Set(K.Z);
				eventually(() => !poke.IsPressed() && counts.Released.count >= 1, "the rebind's release");
				settle();
				const atRebind = watched.Text();
				const edgesAtRebind = counts.Order.join("");
				log.push("|false");
				poke.Fire(false);
				settle();
				expectTrue(
					watched.Taps.count === 0 && watched.Doubles.count === 0 && watched.Longs.size() === 0,
					`${RESET_PROMISE}; Fire(true), then Set(Z) 0.1 s later while it held the action: ` +
						`${atRebind} after the rebind (handle edges ${edgesAtRebind}), ${watched.Text()} after ` +
						`Fire(false) (edges ${counts.Order.join("")}; IAS: ${log.join(" ")}; ${where()})`,
				);
			});

			// probe (passed in every project, authority included): a rebind, an AttachButton or the first Fire while a real key holds the action on the copy
			test("probe: a Server Authority copy: a rebind or an AttachButton while a real key holds the action completes no gesture", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const results = new Array<string>();
				let ok = true;
				const resets: Array<[string, (poke: InputActions.BoolAction) => void]> = [
					["Set(Z)", (poke) => poke.Bindings.KeyboardAndMouse.Set(K.Z)],
					[
						"AttachButton",
						(poke) => {
							const button = new Instance("TextButton");
							defer(() => button.Destroy());
							poke.AttachButton(button);
						},
					],
					["the first Fire(false)", (poke) => poke.Fire(false)],
				];
				for (const [what, reset] of resets) {
					const input = saCopy();
					const poke = input.Hf3Sa.Actions.Poke;
					const counts = edges(poke);
					const log = iasLog(poke.Instance);
					const watched = watchGestures(poke);
					real.Press(K.N);
					arrives(() => counts.Pressed.count === 1 && poke.IsPressed(), `N's press${real.FocusNote()}`);
					waitSeconds(0.1);
					log.push(`|${what}`);
					reset(poke);
					settle();
					log.push("|N up");
					real.Release(K.N);
					settle();
					results.push(
						`${what}: ${watched.Text()} (handle edges ${counts.Order.join("")}; IAS: ${log.join(" ")}; pressed ${poke.IsPressed()})`,
					);
					if (watched.Taps.count + watched.Doubles.count + watched.Longs.size() > 0) ok = false;
					input.Destroy();
				}
				expectTrue(
					ok,
					`${RESET_PROMISE}; N held, then 0.1 s later each of these, then N released: ` +
						`${results.join("; ")} (${where()})${real.FocusNote()}`,
				);
			});

			// probe (passed in every project, authority included): HF2-1's press and reset in one frame, on the copy under the player
			test("probe: a Server Authority copy: Fire(true) then a rebind or the context off and on in its frame completes no gesture", () => {
				const results = new Array<string>();
				let ok = true;
				const resets: Array<[string, (input: ReturnType<typeof saCopy>) => void]> = [
					["Set(Z)", (input) => input.Hf3Sa.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.Z)],
					["Request(false) let go at once", (input) => input.Hf3Sa.Request(false)()],
					[
						"AttachButton",
						(input) => {
							const button = new Instance("TextButton");
							defer(() => button.Destroy());
							input.Hf3Sa.Actions.Poke.AttachButton(button);
						},
					],
				];
				for (const [what, reset] of resets) {
					const input = saCopy();
					const poke = input.Hf3Sa.Actions.Poke;
					const counts = edges(poke);
					const log = iasLog(poke.Instance);
					const watched = watchGestures(poke);
					poke.Fire(false);
					frames(2);
					log.push(`|true+${what}`);
					poke.Fire(true);
					reset(input);
					settle();
					log.push("|false");
					poke.Fire(false);
					settle();
					results.push(
						`${what}: ${watched.Text()} (handle edges ${counts.Order.join("")}; IAS: ${log.join(" ")})`,
					);
					if (watched.Taps.count + watched.Doubles.count + watched.Longs.size() > 0) ok = false;
					input.Destroy();
				}
				expectTrue(
					ok,
					"EdgeCases: 'Under Deferred signals a press and a reset can come in one frame, before " +
						"the handle hears the press: Fire(true) then a rebind, a context turned off and on " +
						"again at once ... The release that follows is still the reset's: no tap, and the " +
						"hold is cancelled'; on the copy under the player, Fire(true) and in the same frame " +
						`each of these, then Fire(false): ${results.join("; ")} (${where()})`,
				);
			});

			// HF3-3 (hunter): on a Server Authority copy, the player's release then the context off and on in the same frame: the copy still shows the action held (its state moves on simulation steps), the reset is marked, and the player's release counts as the reset's: no tap
			// DOCUMENTED HF3-3, worker: what IAS shows when the reset is made decides (the one rule, see HF3-1); the copy shows a key-up or a Fire(false) one simulation step later. Telling the package's own Fire(false) apart needs to know when that step lands: a note of a release fired at rest outlives it when a key pressed in the same step keeps the action held, and would skip a later reset's mark. EdgeCases (Gestures and releases the player didn't make) and the design doc §6 say so; the test asserts it: no tap where the copy still showed the action held at the reset, a tap where it didn't (a local context, without Server Authority)
			test("HF3-3: a Server Authority copy: the player's release, then the context off and on in its frame: no tap while the copy still shows the action held, as documented; a tap elsewhere", () => {
				const input = saCopy();
				const poke = input.Hf3Sa.Actions.Poke;
				const counts = edges(poke);
				const log = iasLog(poke.Instance);
				const watched = watchGestures(poke);
				poke.Fire(true);
				eventually(() => counts.Pressed.count === 1 && poke.IsPressed(), "the press");
				frames(2);
				log.push("|false+request");
				poke.Fire(false);
				const heldAtReset = poke.IsPressed();
				input.Hf3Sa.Request(false)();
				eventually(() => counts.Released.count === 1, "the release");
				settle();
				const expected = heldAtReset ? "no tap and no long press" : "a tap and a long press";
				const got = heldAtReset
					? watched.Taps.count === 0 && watched.Longs.size() === 0
					: watched.Taps.count === 1 && watched.Longs.size() === 1;
				expectTrue(
					got,
					"EdgeCases (Gestures and releases the player didn't make): 'What IAS shows when the " +
						"reset is made decides ... The server's copy of a Server Authority context, in the " +
						"simulation step after the release ... Fire(false) then Request(false) in the same " +
						"frame is no tap there, where it is one on a local context'; on the copy under the " +
						`player, Fire(false) then Request(false) let go at once, in one frame, the copy ${heldAtReset ? "still showing" : "no longer showing"} ` +
						`the action held at the reset: expected ${expected}; got ${watched.Text()} (handle ` +
						`edges ${counts.Order.join("")}; IAS: ${log.join(" ")}; ${where()})`,
				);
			});

			// evidence for HF3-4 (compile time, hunter-features-3-type-rules.ts; fixed there: the types refuse each under a computed name now): Schema refuses, under every name, each computed-name binding the types accepted
			test("HF3-4 evidence: Schema refuses, under every name, the computed-name bindings the types accept", () => {
				const builders = {
					Bool: InputActions.Bool,
					Direction1D: InputActions.Direction1D,
					Direction2D: InputActions.Direction2D,
				} as unknown as Record<string, (bindings: unknown) => unknown>;
				const values: Array<[string, string, unknown]> = [
					["Bool", "a property no binding has, beside a key", { KeyCode: K.E, Typo: 1 }],
					["Bool", "Scale on a Bool binding", { KeyCode: K.E, Scale: 2 }],
					["Bool", "a composite direction on a Bool binding", { KeyCode: K.E, Up: K.W }],
					["Direction1D", "ResponseCurve on a Direction1D binding", { KeyCode: K.ButtonR2, ResponseCurve: 2 }],
					["Direction2D", "PressedThreshold on a Direction2D composite", { Up: K.W, Down: K.S, PressedThreshold: 0.5 }],
					["Bool", "a typo in a namespace's extra", { Main: K.E, Alt: { KeyCode: K.Q, Typo: 1 } }],
					["Bool", "an extra named with /", { Main: K.E, ["a/b"]: K.Q }],
					["Bool", "an extra with the empty name", { Main: K.E, [""]: K.Q }],
					["Bool", "MouseDelta on a Bool action", K.MouseDelta],
				];
				const accepted = new Array<string>();
				for (const [actionType, what, value] of values) {
					for (const name of ["KeyboardAndMouse", "Gamepad", "Touch", "Other"]) {
						const [ok] = pcall(() =>
							InputActions.Schema({
								Play: { Actions: { Jump: builders[actionType]({ [name]: value }) } },
							} as never),
						);
						if (ok) accepted.push(`${what} under ${name}`);
					}
				}
				expectArrayEqual(accepted, [], "Schema should refuse each value under every name");
			});

			// HF3-5 (hunter, fixed: the binding handles of every live root handle are kept per InputBinding, and a change through one root handle fires each other one's BindingsChanged with its own path: Set and the captures, imports and resets, a later Create's fill once its Build is over, the swap's writes onto an adopted binding at its end): with two root handles on one folder, a rebind (Set, an import, a reset) through one changed what the other's Describe reads, and the other's BindingsChanged didn't fire: a hint refreshed on it, as the docs say, stayed stale
			test("HF3-5: two root handles on one folder: a rebind through one fires the other's BindingsChanged, whose Describe it changes", () => {
				const small = InputActions.Schema({
					Hf3Hint: { Priority: 3300, Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.N }) } },
				});
				const big = InputActions.Schema({
					Hf3Hint: {
						Priority: 3300,
						Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.N, Gamepad: K.ButtonY }) },
					},
				});
				const folder = newFolder();
				const hud = InputActions.Create(small, { Folder: folder, ResetOnFocusLoss: false });
				defer(() => hud.Destroy());
				const hudJump = hud.Hf3Hint.Actions.Jump;
				const heard = new Array<string>();
				const connection = hud.BindingsChanged.Connect((path) => heard.push(path));
				defer(() => connection.Disconnect());
				const steps = new Array<string>();
				// worker, HF3-5: each change of what the HUD reads fires the HUD's BindingsChanged once,
				// with the HUD's path for the binding that changed
				const step = (what: string, path: string, change: () => void) => {
					const before = `${hudJump.Describe("KeyboardAndMouse")}|${hudJump.Describe("Gamepad")}`;
					const count = heard.size();
					change();
					frames(2);
					const after = `${hudJump.Describe("KeyboardAndMouse")}|${hudJump.Describe("Gamepad")}`;
					const paths = heard.filter((_, index) => index >= count);
					steps.push(`${what}: the HUD's Describe ${before} -> ${after}, its BindingsChanged [${paths.join(", ")}]`);
					return before !== after && paths.size() === 1 && paths[0] === path;
				};
				const createMenu = () => InputActions.Create(big, { Folder: folder, ResetOnFocusLoss: false });
				const holder: { menu?: ReturnType<typeof createMenu> } = {};
				const KEYS = "Hf3Hint/Jump/KeyboardAndMouse";
				const fill = step("a second Create filling Gamepad", "Hf3Hint/Jump/Gamepad", () => {
					holder.menu = createMenu();
				});
				const menu = holder.menu!;
				defer(() => menu.Destroy());
				const menuJump = menu.Hf3Hint.Actions.Jump;
				const set = step("the menu's Set(M)", KEYS, () => menuJump.Bindings.KeyboardAndMouse.Set(K.M));
				const imported = step("the menu's ImportBindings", KEYS, () => {
					menu.ImportBindings(
						'{"Version":1,"Bindings":{"Hf3Hint/Jump/KeyboardAndMouse":{"KeyCode":"U"}}}',
					);
				});
				const reset = step("the menu's ResetBindings", KEYS, () => menu.ResetBindings());
				expectTrue(
					fill && set && imported && reset,
					"Advanced (Keybinds as text): 'action.Describe(device?) ... Refresh it on " +
						"PreferredDeviceChanged and BindingsChanged (which a rebind made through another root " +
						"handle on the same folder fires too)'; API: BindingsChanged 'fires on every root " +
						"handle that has the binding, with its own path: a change made through another root " +
						"handle on the same folder, or a later Create filling the binding, included'. A HUD's " +
						"root handle and a menu's on one folder, the HUD refreshing its hint on its own " +
						`BindingsChanged: ${steps.join("; ")}; expected each to change what the HUD reads and ` +
						`fire its BindingsChanged once, with the path of the binding changed (${where()})`,
				);
			});

			// worker, HF3-5: the root handle a change is made through hears it once, as before (Set always, a change or not), the other one when it changed; a destroyed root handle hears nothing, and the others still do
			test("worker, HF3-5: a rebind reaches the other root handle either way, once; not a destroyed one", () => {
				const schema = InputActions.Schema({
					Hf3Both: { Priority: 3300, Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.N }) } },
				});
				const folder = newFolder();
				const first = InputActions.Create(schema, { Folder: folder, ResetOnFocusLoss: false });
				defer(() => first.Destroy());
				const second = InputActions.Create(schema, { Folder: folder, ResetOnFocusLoss: false });
				defer(() => second.Destroy());
				const heard = { first: new Array<string>(), second: new Array<string>() };
				const connections = [
					first.BindingsChanged.Connect((path) => heard.first.push(path)),
					second.BindingsChanged.Connect((path) => heard.second.push(path)),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				const read = () => `first [${heard.first.join(", ")}], second [${heard.second.join(", ")}]`;
				const PATH = "Hf3Both/Jump/KeyboardAndMouse";
				first.Hf3Both.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.M);
				frames(2);
				expectEqual(read(), `first [${PATH}], second [${PATH}]`, "Set(M) through the first");
				second.Hf3Both.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.U);
				frames(2);
				expectEqual(read(), `first [${PATH}, ${PATH}], second [${PATH}, ${PATH}]`, "Set(U) through the second");
				// the same key again: the second's own BindingsChanged fires (as Set always did), the first's not
				second.Hf3Both.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.U);
				frames(2);
				expectEqual(
					read(),
					`first [${PATH}, ${PATH}], second [${PATH}, ${PATH}, ${PATH}]`,
					"Set(U) again through the second: no change for the first",
				);
				second.Destroy();
				first.Hf3Both.Actions.Jump.Bindings.KeyboardAndMouse.Set(K.J);
				frames(2);
				expectEqual(
					read(),
					`first [${PATH}, ${PATH}, ${PATH}], second [${PATH}, ${PATH}, ${PATH}]`,
					"Set(J) through the first once the second was destroyed",
				);
				expectEqual(first.Hf3Both.Actions.Jump.Describe("KeyboardAndMouse"), "J");
			});

			// worker, HF3-5: the Server Authority swap writes a stand-in's rebind onto a binding another root handle already has on the server's copy: that root handle's BindingsChanged fires, once the swap is done
			test("worker, HF3-5: the swap writing a stand-in's rebind onto another root handle's binding fires that one's BindingsChanged", () => {
				copies++;
				const playerFolder = new Instance("Folder");
				playerFolder.Name = `InputsHf3Swap${copies}`;
				const copy = new Instance("InputContext");
				copy.Name = "Hf3Swap";
				copy.Priority = 3300;
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
				// the later schema needs an action the copy lacks yet: it waits on a stand-in
				const late = InputActions.Create(
					InputActions.Schema({
						Hf3Swap: {
							ServerAuthority: true,
							Priority: 3300,
							Actions: {
								Poke: InputActions.Bool({ KeyboardAndMouse: K.N }),
								Spare: InputActions.Bool({ KeyboardAndMouse: K.J }),
							},
						},
					}),
					options,
				);
				defer(() => late.Destroy());
				expectTrue(!late.Hf3Swap.IsLinkedToServer(), "the later schema on its stand-in");
				const early = InputActions.Create(
					InputActions.Schema({
						Hf3Swap: {
							ServerAuthority: true,
							Priority: 3300,
							Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.N }) },
						},
					}),
					options,
				);
				defer(() => early.Destroy());
				expectTrue(early.Hf3Swap.IsLinkedToServer(), "the earlier schema on the copy at once");
				const heard = new Array<string>();
				const connection = early.BindingsChanged.Connect((path) => heard.push(path));
				defer(() => connection.Disconnect());
				late.Hf3Swap.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.M);
				frames(2);
				expectArrayEqual(heard, [], "a rebind on the stand-in is no binding the copy's root handle has");
				const spare = new Instance("InputAction");
				spare.Name = "Spare";
				spare.Type = Enum.InputActionType.Bool;
				spare.Parent = copy;
				eventually(() => late.Hf3Swap.IsLinkedToServer(), "the swap");
				frames(2);
				expectEqual(
					early.Hf3Swap.Actions.Poke.Describe("KeyboardAndMouse"),
					"M",
					"the stand-in's rebind written onto the binding both have now",
				);
				expectArrayEqual(heard, ["Hf3Swap/Poke/KeyboardAndMouse"], `the copy's root handle heard it (${where()})`);
			});

			// HF3-6 (hunter, docs): UserInputService.InputEnded for a key runs while IAS still shows its action held (measured in all six projects, local contexts too), so a reset made there (a key-up handler turning the context off and on, or off: the next test) is marked and takes the player's release for the reset's: no tap. EdgeCases named InputBegan handlers for presses, and promised a tap for "a key let go of, then the context turned off and on in the same frame"
			// DOCUMENTED HF3-6, worker: the package can't see the key's release before IAS does, and what IAS shows when the reset is made decides (the one rule, see HF3-1). EdgeCases (beside the InputBegan case, with the advice to act on Released or a gesture instead), Advanced (Gestures) and the design doc §6 say so; the tests assert it: no tap while IAS showed the action held in the handler, a tap if it didn't
			test("HF3-6: a real key whose InputEnded handler turns the context off and on: no tap while IAS still shows the action held there, as documented", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const results = new Array<string>();
				let ok = true;
				type PokeContext = {
					Actions: { Poke: InputActions.BoolAction };
					Request(enabled: boolean): () => void;
				};
				const contexts: Array<[string, () => PokeContext]> = [
					["a local context", () => createGestures().Hf3Gestures as unknown as PokeContext],
					["the copy under the player", () => saCopy().Hf3Sa as unknown as PokeContext],
				];
				for (const [what, make] of contexts) {
					const context = make();
					const poke = context.Actions.Poke;
					const counts = edges(poke);
					const log = iasLog(poke.Instance);
					const watched = watchGestures(poke);
					let stateAtEnded: boolean | undefined;
					const connection = UserInputService.InputEnded.Connect((input) => {
						if (input.KeyCode !== K.N || stateAtEnded !== undefined) return;
						stateAtEnded = poke.IsPressed();
						log.push("|ended");
						context.Request(false)();
					});
					defer(() => connection.Disconnect());
					real.Press(K.N);
					arrives(() => counts.Pressed.count === 1 && poke.IsPressed(), `N's press${real.FocusNote()}`);
					frames(3);
					real.Release(K.N);
					arrives(() => stateAtEnded !== undefined && counts.Released.count === 1, `N's release${real.FocusNote()}`);
					settle();
					connection.Disconnect();
					results.push(
						`${what}: ${watched.Text()} (pressed at InputEnded: ${stateAtEnded}; handle edges ${counts.Order.join("")}; IAS: ${log.join(" ")})`,
					);
					// documented: a reset while IAS shows the action held is the reset's release
					if (stateAtEnded === true) {
						if (watched.Taps.count + watched.Longs.size() > 0) ok = false;
					} else if (watched.Taps.count !== 1 || watched.Longs.size() !== 1) ok = false;
				}
				expectTrue(
					ok,
					"EdgeCases (Gestures and releases the player didn't make): 'What IAS shows when the " +
						"reset is made decides ... A key's UserInputService.InputEnded handler. IAS still shows " +
						"the key's action held while that event's handlers run ... A key-up handler that turns " +
						"the context off (or off and on again) ends the gesture as a reset'; N tapped, its " +
						"InputEnded handler turning the context off and on: expected no tap and no long press " +
						"where the action read pressed in the handler, a tap and a long press where it didn't; " +
						`${results.join("; ")} (${where()})${real.FocusNote()}`,
				);
			});

			// HF3-6 (hunter, docs), also: the key's InputEnded handler turns the context off and leaves it off (a key-up that opens a menu); fails under both signal modes, so not HF3-2 (the reset is marked: IAS shows the action held there)
			// DOCUMENTED HF3-6, worker: as above
			test("HF3-6, also: a real key whose InputEnded handler turns the context off: no tap while IAS still shows the action held there, as documented", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const input = createGestures();
				const context = input.Hf3Gestures;
				const poke = context.Actions.Poke;
				const counts = edges(poke);
				const log = iasLog(poke.Instance);
				const watched = watchGestures(poke);
				let stateAtEnded: boolean | undefined;
				const connection = UserInputService.InputEnded.Connect((inputObject) => {
					if (inputObject.KeyCode !== K.N || stateAtEnded !== undefined) return;
					stateAtEnded = poke.IsPressed();
					log.push("|ended");
					context.SetEnabled(false);
				});
				defer(() => connection.Disconnect());
				real.Press(K.N);
				arrives(() => counts.Pressed.count === 1 && poke.IsPressed(), `N's press${real.FocusNote()}`);
				frames(3);
				real.Release(K.N);
				arrives(() => stateAtEnded !== undefined && counts.Released.count === 1, `N's release${real.FocusNote()}`);
				settle();
				context.SetEnabled(true);
				const documented =
					stateAtEnded === true
						? watched.Taps.count === 0 && watched.Longs.size() === 0
						: watched.Taps.count === 1 && watched.Longs.size() === 1;
				expectTrue(
					documented,
					"EdgeCases (Gestures and releases the player didn't make): 'A key-up handler that " +
						"turns the context off (or off and on again) ends the gesture as a reset' while IAS " +
						"still shows the action held there; N tapped, its InputEnded handler turning the " +
						`context off (a key-up that opens a menu): expected ${stateAtEnded === true ? "no tap and no long press" : "a tap and a long press"}; ` +
						`${watched.Text()} (pressed at InputEnded: ${stateAtEnded}; handle edges ` +
						`${counts.Order.join("")}; IAS: ${log.join(" ")}; ${where()})${real.FocusNote()}`,
				);
			});

			test("probe: gestures and TrackPrevious on one action: a press and release in one frame", () => {
				const schema = InputActions.Schema({
					Hf3Track: {
						Priority: 3300,
						Actions: {
							Poke: InputActions.Bool({ KeyboardAndMouse: K.N }, { TrackPrevious: true }),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const poke = input.Hf3Track.Actions.Poke;
				const counts = edges(poke);
				const [taps, onTap] = counter();
				poke.OnTap(onTap);
				const flags = new Array<string>();
				const connection = RunService.Heartbeat.Connect(() => {
					if (poke.IsJustPressed() || poke.IsJustReleased())
						flags.push(`${poke.IsJustPressed() ? "J" : ""}${poke.IsJustReleased() ? "R" : ""}`);
				});
				defer(() => connection.Disconnect());
				frames(2);
				poke.Fire(true);
				poke.Fire(false);
				eventually(() => counts.Released.count === 1, "the release");
				frames(4);
				expectEqual(taps.count, 1, `one tap (edges ${counts.Order.join("")}, ${where()})`);
				expectTrue(
					flags.includes("JR"),
					`IsJustPressed and IsJustReleased on one frame: ${flags.join(",")} (${where()})`,
				);
			});

			test("probe: extras with an import, a reset and AttachButton: FindConflicts and Describe follow", () => {
				const schema = InputActions.Schema({
					Hf3Extras: {
						Priority: 3300,
						Actions: {
							Poke: InputActions.Bool({ KeyboardAndMouse: { Main: K.N, Alt: K.J } }),
							Use: InputActions.Bool({ KeyboardAndMouse: K.M }),
						},
					},
				});
				const input = InputActions.Create(schema, { Folder: newFolder(), ResetOnFocusLoss: false });
				defer(() => input.Destroy());
				const { Poke, Use } = input.Hf3Extras.Actions;
				const paths = () =>
					input
						.FindConflicts(Use.Bindings.KeyboardAndMouse)
						.map((conflict) => `${conflict.Path}:${conflict.Slot}:${conflict.Identical}`);
				expectArrayEqual(paths(), [], "no conflict at first");
				const before = input.ExportBindings();
				const result = input.ImportBindings(
					'{"Version":1,"Bindings":{"Hf3Extras/Poke/KeyboardAndMouse/Alt":{"KeyCode":"M"}}}',
				);
				expectArrayEqual(result.Skipped.map((entry) => entry.Path), [], "imported");
				expectEqual(Poke.Bindings.KeyboardAndMouse.Alt.Describe(), "M");
				expectArrayEqual(paths(), ["Hf3Extras/Poke/KeyboardAndMouse/Alt:KeyCode:true"]);
				const button = new Instance("TextButton");
				defer(() => button.Destroy());
				const detach = Poke.AttachButton(button);
				expectArrayEqual(paths(), ["Hf3Extras/Poke/KeyboardAndMouse/Alt:KeyCode:true"], "a button changes nothing");
				detach();
				input.ResetBindings();
				expectEqual(Poke.Bindings.KeyboardAndMouse.Alt.Describe(), "J");
				expectArrayEqual(paths(), [], "after ResetBindings");
				expectEqual(input.ExportBindings(), before, "the export back to the defaults");
				expectEqual(
					Poke.Instance.GetChildren().filter((child) => child.Name.find("UIButton", 1, true)[0] !== undefined).size(),
					0,
					"the button's binding gone",
				);
			});

			test("probe: PreferredDeviceChanged with two listeners, one disconnected", () => {
				if (getProject() !== "touch")
					return skip("the touch project only: a key and a tap switch devices");
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const first = new Array<string>();
				const second = new Array<string>();
				const a = InputActions.PreferredDeviceChanged.Connect((device) => first.push(device));
				const b = InputActions.PreferredDeviceChanged.Connect((device) => second.push(device));
				defer(() => {
					a.Disconnect();
					b.Disconnect();
				});
				real.Click(emptyPoint());
				frames(3);
				const start = InputActions.PreferredDevice();
				first.clear();
				second.clear();
				const other = start === "Touch" ? "KeyboardAndMouse" : "Touch";
				const switchTo = (input: RealInput) => {
					if (InputActions.PreferredDevice() === "Touch") input.Tap(K.U);
					else input.Click(emptyPoint());
				};
				switchTo(real);
				eventually(() => first.size() === 1 && second.size() === 1, `the switch: ${first.join(",")} / ${second.join(",")}`);
				expectEqual(first[0], other);
				expectEqual(second[0], other);
				a.Disconnect();
				switchTo(real);
				eventually(() => second.size() === 2, `the switch back: ${first.join(",")} / ${second.join(",")}`);
				frames(3);
				expectEqual(first.size(), 1, "the disconnected listener heard nothing more");
				expectEqual(second[1], start);
			});
		});
	}
}
