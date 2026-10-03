import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectTrue,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players } from "@rbxts/services";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { frames, newFolder, recordSignal } from "./helpers";
import { realInput } from "./virtual";

const K = Enum.KeyCode;

/** A new InputActionLabel, or why there is none: the class is a Studio beta (2026-08) */
function newLabel(): InputActionLabel | string {
	const [ok, made] = pcall(() => new Instance("InputActionLabel"));
	if (!ok) return `no InputActionLabel here (a Studio beta): ${made}`;
	const label = made as InputActionLabel;
	label.Size = UDim2.fromOffset(120, 40);
	defer(() => label.Destroy());
	return label;
}

/** Where a label points, for a failure message */
function pointsAt(label: InputActionLabel) {
	const action = label.InputAction;
	return action === undefined ? "nothing" : action.GetFullName();
}

/** A Server Authority context declared off: a root handle holds it on with `Request(true)` */
const HL3_OFF_SCHEMA = InputActions.Schema({
	Hl3Swap: {
		ServerAuthority: true,
		Enabled: false,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

const HL3_SCHEMA = InputActions.Schema({
	Hl3Swap: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

/** The same context with Jump only: a root handle on it is satisfied by a copy without Duck */
const HL3_SMALL_SCHEMA = InputActions.Schema({
	Hl3Swap: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});

/** Two schemas on one local context: the second adds an action the first lacks */
const HL3_LOCAL_SMALL = InputActions.Schema({
	Hl3Local: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
const HL3_LOCAL_BIG = InputActions.Schema({
	Hl3Local: {
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Extra: InputActions.Bool({ KeyboardAndMouse: K.K }),
		},
	},
});

/** Two schemas sharing one action: the second gives it a binding the first lacks */
const HL3_KEYS_SMALL = InputActions.Schema({
	Hl3Keys: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) } },
});
const HL3_KEYS_BIG = InputActions.Schema({
	Hl3Keys: {
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J, Alternate: K.K }) },
	},
});

/** `Create`, destroyed after the test */
function create<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	options: InputActions.CreateOptions,
): InputActions.Handle<S> {
	const input = InputActions.Create(schema, options);
	defer(() => input.Destroy());
	return input;
}

/** Options for a root handle waiting on a hand-made copy under that player folder */
function swapOptions(folderName: string): InputActions.CreateOptions {
	return {
		Folder: newFolder(),
		PlayerFolderName: folderName,
		Timeout: 1000,
		ResetOnFocusLoss: false,
	};
}

let copyCount = 0;

/**
 * A copy of `Hl3Swap` built by hand under a player folder no server provides, as the server's would
 * be (enabled, as the server makes it): the folder, the context and its Bool actions, not parented
 * to the player yet
 */
function handMadeCopy(actionNames: string[] = ["Jump", "Duck"]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterLabel3Copy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = "Hl3Swap";
	const actions = new Map<string, InputAction>();
	for (const name of actionNames) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Parent = context;
		actions.set(name, action);
	}
	context.Parent = folder;
	defer(() => folder.Destroy());
	return { folder, context, actions };
}

/** Hunt round 3: the swap's new order and the labels after the round 2 fixes (1b337b9), adversarial */
@Provider({ activeIn: ["testing"] })
export class HunterLabel3Tests implements OnStart {
	onStart() {
		defineTests("hunter-label-3", () => {
			// ---- root handles destroyed or made by a listener during the swap's releases

			// HL3-1 (hunter, fixed: the swap releases every held value before it touches the copy, and leaves the copy unclaimed when no live root handle is left; Immediate signals only): every root handle on a stand-in destroyed by a listener during the swap's releases: LinkStandIn had already claimed the copy (ClaimCopy) and carried the stand-in's action Enabled onto it, then returned, so the next Create took up a copy whose context kept the server's Enabled and whose action kept the destroyed handle's
			test("every root handle on a stand-in destroyed by a listener during the swap's releases: the next Create takes up the copy with the schema's Enabled", () => {
				if (expectedSignalBehavior() !== "Immediate")
					return skip("listeners run inside the swap under Immediate signals only");
				const copy = handMadeCopy();
				const input = create(HL3_OFF_SCHEMA, swapOptions(copy.folder.Name));
				const context = input.Hl3Swap;
				context.Request(true);
				const { Jump: jump, Duck: duck } = context.Actions;
				duck.SetEnabled(false);
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "held on the stand-in");
				frames(2);
				let destroyedIn = "";
				const connection = jump.Released.Connect(() => {
					if (destroyedIn !== "") return;
					destroyedIn = `on ${jump.Instance.GetFullName()}, linked ${context.IsLinkedToServer()}`;
					input.Destroy();
				});
				defer(() => connection.Disconnect());
				copy.folder.Parent = Players.LocalPlayer;
				// A Create on that player folder swaps the waiting stand-in first, in this thread
				const later = create(HL3_OFF_SCHEMA, swapOptions(copy.folder.Name));
				expectTrue(
					destroyedIn !== "",
					"the swap released Jump and the listener destroyed the root",
				);
				expectTrue(later.Hl3Swap.IsLinkedToServer(), "the later Create is on the copy");
				expectEqual(
					`context ${later.Hl3Swap.IsEnabled()} (instance ${copy.context.Enabled}), Duck ${later.Hl3Swap.Actions.Duck.IsEnabled()}`,
					"context false (instance false), Duck true",
					`the only root handle on the stand-in was destroyed during the swap's releases (${destroyedIn}). "A root handle a listener destroys takes no further part: one destroyed during the releases is dropped from the swap, so it takes no use of the copy" (IAS-Rework §8), so the later Create is the first to take up the copy, which "the first time the package takes them up" gets "the template's Enabled ..., else the schema's" (Advanced.md, Server Authority): the schema declares the context Enabled: false and Duck enabled. The control below gets that when the root handle is destroyed before the swap`,
				);
			});

			test("control: the root handle destroyed before its copy arrives: the next Create takes up the copy with the schema's Enabled", () => {
				const copy = handMadeCopy();
				const input = create(HL3_OFF_SCHEMA, swapOptions(copy.folder.Name));
				input.Hl3Swap.Request(true);
				input.Hl3Swap.Actions.Duck.SetEnabled(false);
				input.Hl3Swap.Actions.Jump.Fire(true);
				frames(2);
				input.Destroy();
				copy.folder.Parent = Players.LocalPlayer;
				const later = create(HL3_OFF_SCHEMA, swapOptions(copy.folder.Name));
				expectTrue(later.Hl3Swap.IsLinkedToServer(), "the later Create is on the copy");
				expectEqual(
					`context ${later.Hl3Swap.IsEnabled()} (instance ${copy.context.Enabled}), Duck ${later.Hl3Swap.Actions.Duck.IsEnabled()}`,
					"context false (instance false), Duck true",
				);
			});

			// HL3-1 (hunter, fixed as above; same cause, Immediate signals): a Create from a listener during the swap's releases found the copy claimed but its Enabled not written yet, took the server's `true` as the context's base state, and that base state won at the Join: the stand-in's base state (false) was lost
			test("a Create from a listener during the swap's releases: the context keeps the base state it had on the stand-in", () => {
				const copy = handMadeCopy();
				const input = create(HL3_OFF_SCHEMA, swapOptions(copy.folder.Name));
				const context = input.Hl3Swap;
				const release = context.Request(true);
				const jump = context.Actions.Jump;
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "held on the stand-in");
				frames(2);
				// made here: the listener runs in a thread of its own
				const nestedOptions = swapOptions(copy.folder.Name);
				const made: { Handle?: { Hl3Swap: { IsEnabled(): boolean }; Destroy(): void } } = {};
				defer(() => made.Handle?.Destroy());
				let madeIn = "";
				const connection = jump.Released.Connect(() => {
					if (madeIn !== "") return;
					madeIn = `made with the first root handle linked ${context.IsLinkedToServer()}, its Jump on ${jump.Instance.GetFullName()}`;
					made.Handle = InputActions.Create(HL3_OFF_SCHEMA, nestedOptions);
				});
				defer(() => connection.Disconnect());
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => context.IsLinkedToServer() && made.Handle !== undefined,
					"the swap, and the Create from its Released",
				);
				frames(2);
				release();
				frames(2);
				const nested = made.Handle!;
				expectEqual(
					`first ${context.IsEnabled()}, nested ${nested.Hl3Swap.IsEnabled()}, instance ${copy.context.Enabled}`,
					"first false, nested false, instance false",
					`signals ${expectedSignalBehavior()}, nested Create ${madeIn}. The schema declares the context Enabled: false, the stand-in held it on with Request(true) only, and "the context keeps its base state and held requests" at the swap (Advanced.md); a Create that finds the copy after the swap shares that state (Deferred signals). Once the request ends, nothing holds it on`,
				);
			});

			// ---- ReleaseActions when a listener destroys a root handle mid-loop (Immediate signals)

			// Probe (passes): under Immediate signals ReleaseActions loops over state.Handles while a Released listener destroys the first root handle, whose ContextHandle.Destroy removes it from that array, so the next root handle's actions are skipped and their held Scriptable values not fired at rest before the disable. Measured: no effect shows, on a local context (no Server Authority runs Immediate): the disabled context releases the action, it stays at rest when enabled again, and the next Fire(true) presses it
			test("a listener that destroys a root handle while its context's releases run: the other root handle's actions are still let go", () => {
				const folder = newFolder();
				const first = create(HL3_LOCAL_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL3_LOCAL_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl3Local.Actions.Jump;
				const extra = second.Hl3Local.Actions.Extra;
				expectEqual(second.Hl3Local.Instance, first.Hl3Local.Instance, "one shared context");
				jump.Fire(true);
				extra.Fire(true);
				eventually(() => jump.IsPressed() && extra.IsPressed(), "both held");
				frames(2);
				let destroyed = false;
				const connection = jump.Released.Connect(() => {
					if (destroyed) return;
					destroyed = true;
					first.Destroy();
				});
				defer(() => connection.Disconnect());
				second.Hl3Local.SetEnabled(false);
				eventually(() => destroyed, "Jump released by the disable");
				frames(2);
				const whileOff = extra.IsPressed();
				second.Hl3Local.SetEnabled(true);
				frames(3);
				const backOn = extra.IsPressed();
				extra.Fire(true);
				frames(2);
				const firedAgain = extra.IsPressed();
				extra.Fire(false);
				expectEqual(
					`off ${whileOff}, back on ${backOn}, Fire(true) then ${firedAgain}`,
					"off false, back on false, Fire(true) then true",
					`signals ${expectedSignalBehavior()}: "Disabling a context releases its held actions" (Advanced.md); the package fires the value at rest on its held Scriptable bindings before the disable ("Released before disabling: a Fire on a disabled context is ignored")`,
				);
			});

			test("control: the same disable with no listener: the other root handle's action is let go", () => {
				const folder = newFolder();
				const first = create(HL3_LOCAL_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL3_LOCAL_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const extra = second.Hl3Local.Actions.Extra;
				first.Hl3Local.Actions.Jump.Fire(true);
				extra.Fire(true);
				eventually(() => extra.IsPressed(), "held");
				frames(2);
				second.Hl3Local.SetEnabled(false);
				frames(2);
				const whileOff = extra.IsPressed();
				second.Hl3Local.SetEnabled(true);
				frames(3);
				const backOn = extra.IsPressed();
				extra.Fire(true);
				frames(2);
				const firedAgain = extra.IsPressed();
				extra.Fire(false);
				expectEqual(
					`off ${whileOff}, back on ${backOn}, Fire(true) then ${firedAgain}`,
					"off false, back on false, Fire(true) then true",
				);
			});

			// ---- a shared action held through a binding only the destroyed root handle had

			// HL3-2 (hunter, fixed: when bindings that go with the root handle go while its shared action is not at rest and nothing another handle fired holds it, a pair on <Action>Script releases it, as for buttons): Destroy of a root handle on an action another root handle still uses destroyed the bindings only it had (its own slots) without letting go of what they held: a key held through one left the shared action stuck on after the key came up (ReleaseOwn handled Fire values and buttons only; ResetIfHeld only actions no one else uses)
			test("a root handle destroyed while a key holds a shared action through a binding only it has: the action comes to rest once the key is up", () => {
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const folder = newFolder();
				const first = create(HL3_KEYS_SMALL, { Folder: folder, ResetOnFocusLoss: false });
				const second = create(HL3_KEYS_BIG, { Folder: folder, ResetOnFocusLoss: false });
				const jump = first.Hl3Keys.Actions.Jump;
				expectEqual(second.Hl3Keys.Actions.Jump.Instance, jump.Instance, "one shared action");
				const alternate = second.Hl3Keys.Actions.Jump.Bindings.Alternate.Instance;
				real.Press(K.K);
				eventually(
					() => jump.IsPressed(),
					`K holds Jump through the second root handle's Alternate binding${real.FocusNote()}`,
				);
				second.Destroy();
				frames(2);
				const afterDestroy = jump.IsPressed();
				const bindingGone = alternate.Parent === undefined;
				real.Release(K.K);
				frames(5);
				expectFalse(
					jump.IsPressed(),
					`signals ${expectedSignalBehavior()}: after the second root handle's Destroy (its Alternate binding destroyed: ${bindingGone}; Jump pressed then: ${afterDestroy}) and K's release, the first root handle's Jump stays pressed. Advanced.md: "destroying one handle leaves what another still uses (instances, held input, requests)", "On an action another handle still uses, Destroy lets go of what the destroyed handle held itself", and "an action that stays after Destroy ... and is still not at rest once the package's bindings are gone is reset"${real.FocusNote()}`,
				);
			});

			// ---- the order of the swap's events on the Join path

			// HL3-3 (hunter, fixed: a handle drops a StateChanged repeating what its listeners have, from the swap on or once it passed one on): on the Join path, ContextState.Join's releases run before FinishLink (round 2's new order): a joining handle already attached to the copy heard the copy's own StateChanged before the swap told it the copy's state, and repeated the value its listeners have
			test("a stand-in handle joining a copy that the Join turns off: its StateChanged doesn't repeat the value its listeners have", () => {
				const copy = handMadeCopy(["Jump"]);
				copy.folder.Parent = Players.LocalPlayer;
				const onCopy = create(HL3_SMALL_SCHEMA, swapOptions(copy.folder.Name));
				expectTrue(onCopy.Hl3Swap.IsLinkedToServer(), "linked at Create");
				const jumpCopy = copy.actions.get("Jump")!;
				const waiting = create(HL3_SCHEMA, swapOptions(copy.folder.Name));
				expectFalse(waiting.Hl3Swap.IsLinkedToServer(), "the copy lacks Duck");
				const jump = waiting.Hl3Swap.Actions.Jump;
				const heard = recordSignal(jump.StateChanged);
				jump.Fire(true);
				eventually(() => heard.size() === 1, "the stand-in's press");
				jump.Fire(false);
				eventually(() => heard.size() === 2, "the stand-in's release");
				// the stand-in is off from now on; its request carries over to the copy
				defer(waiting.Hl3Swap.Request(false));
				onCopy.Hl3Swap.Actions.Jump.Fire(true);
				eventually(
					() => jumpCopy.GetState() === true,
					"the other root handle holds the copy's Jump",
				);
				frames(2);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.Hl3Swap.IsLinkedToServer(), "the swap once Duck is there");
				frames(4);
				expectFalse(copy.context.Enabled, "the Request(false) holds the copy off");
				expectFalse(jump.IsPressed(), "at rest on the copy");
				const values = heard.map((value) => tostring(value)).join(", ");
				let repeated = false;
				for (let index = 1; index < heard.size(); index++) {
					if (heard[index] === heard[index - 1]) repeated = true;
				}
				expectFalse(
					repeated,
					`signals ${expectedSignalBehavior()}: Jump's StateChanged on the joining handle: ${values}. "At the swap each handle tells its listeners the copy's state ... before the copy's own events" (IAS-Rework §8; Advanced.md: "each handle passes on the copy's state ..., then the copy's own events"), and StateChanged never repeats across the swap (shared-handles); the handle was at rest before and after`,
				);
			});

			// ---- labels and held values when a root handle goes during the swap

			test("a root handle destroyed from its label's change signal during the swap: its held value isn't fired again, the label is cleared, the other root handle is on the copy", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const first = create(HL3_SCHEMA, swapOptions(copy.folder.Name));
				const second = create(HL3_SCHEMA, swapOptions(copy.folder.Name));
				const jumpCopy = copy.actions.get("Jump")!;
				const duckCopy = copy.actions.get("Duck")!;
				const firstJump = first.Hl3Swap.Actions.Jump;
				firstJump.Fire(true);
				eventually(() => firstJump.IsPressed(), "held on the stand-in");
				frames(2);
				first.Hl3Swap.Actions.Duck.AttachLabel(label);
				let destroyedIn = "";
				const connection = label.GetPropertyChangedSignal("InputAction").Connect(() => {
					if (destroyedIn !== "" || label.InputAction !== duckCopy) return;
					destroyedIn = `first linked ${first.Hl3Swap.IsLinkedToServer()}, its Jump on the copy ${firstJump.Instance === jumpCopy}`;
					first.Destroy();
				});
				defer(() => connection.Disconnect());
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => second.Hl3Swap.IsLinkedToServer() && destroyedIn !== "",
					"the swap, and the label's listener",
				);
				eventually(
					() => jumpCopy.GetState() === false,
					`Jump at rest on the copy (${destroyedIn})`,
				);
				frames(5);
				expectEqual(
					`Jump ${jumpCopy.GetState()}, second's Jump ${second.Hl3Swap.Actions.Jump.IsPressed()}, label on ${pointsAt(label)}, second on the copy ${second.Hl3Swap.Instance === copy.context}`,
					"Jump false, second's Jump false, label on nothing, second on the copy true",
					`signals ${expectedSignalBehavior()}, ${destroyedIn}: "a held value only destroyed root handles held isn't fired again" (IAS-Rework §8, HL2-3); Destroy lets go of the label`,
				);
			});
		});
	}
}
