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
import { createTestInput, frames, newFolder } from "./helpers";
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

const HL2_SCHEMA = InputActions.Schema({
	Hl2Swap: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

/** The same context with Jump only: a root handle on it is satisfied by a copy without Duck */
const HL2_SMALL_SCHEMA = InputActions.Schema({
	Hl2Swap: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});

let copyCount = 0;

/**
 * A copy of `Hl2Swap` built by hand under a player folder no server provides, as the server's would
 * be: the folder, the context and its Bool actions, not parented to the player yet
 */
function handMadeCopy(actionNames: string[] = ["Jump", "Duck"]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterLabel2Copy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = "Hl2Swap";
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

function createSwap(folderName: string, folder: Instance = newFolder()) {
	const input = InputActions.Create(HL2_SCHEMA, {
		Folder: folder,
		PlayerFolderName: folderName,
		Timeout: 1000,
		ResetOnFocusLoss: false,
	});
	defer(() => input.Destroy());
	return input;
}

/**
 * Parents the copy under the player and swaps the waiting stand-in in this thread: a `Create` on the
 * same player folder links it first (Runtime.BuildServerAuthorityContext)
 */
function swapNow(copy: { folder: Folder }) {
	copy.folder.Parent = Players.LocalPlayer;
	return createSwap(copy.folder.Name);
}

/** Hunt round 2: `AttachLabel` and `WhenLinkedToServer` after the round 1 fixes (0985f04), adversarial */
@Provider({ activeIn: ["testing"] })
export class HunterLabel2Tests implements OnStart {
	onStart() {
		defineTests("hunter-label-2", () => {
			// ---- LABEL_OWNERS: the last AttachLabel owns the label

			test("three root handles on one action: the last attachment owns the label; the others' functions and Destroy leave it", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const a = createTestInput(folder);
				const b = createTestInput(folder);
				const c = createTestInput(folder);
				const action = a.Gameplay.Actions.Jump.Instance;
				const detachA = a.Gameplay.Actions.Jump.AttachLabel(label);
				const detachB = b.Gameplay.Actions.Jump.AttachLabel(label);
				const detachC = c.Gameplay.Actions.Jump.AttachLabel(label);
				detachA();
				detachB();
				b.Destroy();
				a.Destroy();
				expectEqual(label.InputAction, action, `after A and B let go: ${pointsAt(label)}`);
				detachC();
				expectEqual(label.InputAction, undefined, `C's function: ${pointsAt(label)}`);
				// owned by no one now: a stale function of any of them changes nothing
				label.InputAction = action;
				detachA();
				detachB();
				detachC();
				expectEqual(
					label.InputAction,
					action,
					`pointed by hand, then stale functions: ${pointsAt(label)}`,
				);
			});

			test("after a takeover the new owner's Destroy clears the label; the old owner's function leaves a later attachment alone", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const detachFirst = first.Gameplay.Actions.Jump.AttachLabel(label);
				second.Gameplay.Actions.Jump.AttachLabel(label);
				// last wins: second owns it; its Destroy lets go and clears it, first's stays let go
				second.Destroy();
				expectEqual(label.InputAction, undefined, `second's Destroy: ${pointsAt(label)}`);
				detachFirst();
				first.Destroy();
				const third = createTestInput();
				const crouch = third.Gameplay.Actions.Crouch;
				const detachThird = crouch.AttachLabel(label);
				expectEqual(label.InputAction, crouch.Instance, pointsAt(label));
				detachFirst();
				expectEqual(
					label.InputAction,
					crouch.Instance,
					`a destroyed root's function: ${pointsAt(label)}`,
				);
				detachThird();
				expectEqual(label.InputAction, undefined, pointsAt(label));
			});

			test("a label taken back by its first handle: the handle that had it in between leaves it alone", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const input = createTestInput();
				const other = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				jump.AttachLabel(label);
				const detachCrouch = other.Gameplay.Actions.Crouch.AttachLabel(label);
				const detachJump = jump.AttachLabel(label);
				detachCrouch();
				other.Destroy();
				expectEqual(label.InputAction, jump.Instance, pointsAt(label));
				detachJump();
				expectEqual(label.InputAction, undefined, pointsAt(label));
			});

			test("a label destroyed while attached is let go of: cleared, and later AttachLabel or functions leave it alone", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const detach = jump.AttachLabel(label);
				label.Destroy();
				eventually(() => label.InputAction === undefined, `cleared: ${pointsAt(label)}`);
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				const none = crouch.AttachLabel(label);
				expectEqual(
					label.InputAction,
					undefined,
					`a destroyed label gets nothing: ${pointsAt(label)}`,
				);
				detach();
				none();
				jump.AttachLabel(label);
				expectEqual(label.InputAction, undefined, pointsAt(label));
			});

			test("labels on every action of a root handle, taken over one by one by another root: Destroy of each leaves the right ones", () => {
				const labels = new Array<InputActionLabel>();
				for (let index = 0; index < 3; index++) {
					const label = newLabel();
					if (typeIs(label, "string")) return skip(label);
					labels.push(label);
				}
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const one = first.Gameplay.Actions;
				const two = second.Gameplay.Actions;
				one.Jump.AttachLabel(labels[0]);
				one.Move.AttachLabel(labels[1]);
				one.Zoom.AttachLabel(labels[2]);
				// second takes over the first two, on the same actions
				two.Jump.AttachLabel(labels[0]);
				two.Move.AttachLabel(labels[1]);
				first.Destroy();
				const after = labels.map((label) => pointsAt(label)).join(" | ");
				expectEqual(labels[0].InputAction, two.Jump.Instance, after);
				expectEqual(labels[1].InputAction, two.Move.Instance, after);
				expectEqual(labels[2].InputAction, undefined, after);
				second.Destroy();
				expectEqual(
					labels.map((label) => pointsAt(label)).join(" | "),
					"nothing | nothing | nothing",
				);
			});

			// HL2-1 (hunter, fixed: AttachLabel attaches the label before it writes InputAction): a label taken over from inside its own InputAction change signal (Immediate signals) stayed attached to both handles; the first one's function then cleared it
			test("a label another root handle takes over from inside its InputAction change signal stays with that handle", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const jump = first.Gameplay.Actions.Jump;
				let takenOver = false;
				const connection = label.GetPropertyChangedSignal("InputAction").Connect(() => {
					if (takenOver || label.InputAction === undefined) return;
					takenOver = true;
					second.Gameplay.Actions.Jump.AttachLabel(label);
				});
				defer(() => connection.Disconnect());
				const detachFirst = jump.AttachLabel(label);
				eventually(() => takenOver, "the change signal ran");
				frames(1);
				detachFirst();
				expectEqual(
					label.InputAction,
					jump.Instance,
					`signals ${expectedSignalBehavior()}: the second root handle attached the label last ("the earlier attachment's function ... then leave it alone"); after the first one's function it points at ${pointsAt(label)}`,
				);
			});

			// HL2-1 (hunter, fixed, same cause): a root handle destroyed from inside its label's InputAction change signal (Immediate signals) left the label on its destroyed action, owned by the destroyed handle
			test("a root handle destroyed from inside its label's InputAction change signal lets go of the label", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const action = jump.Instance;
				let destroyed = false;
				const connection = label.GetPropertyChangedSignal("InputAction").Connect(() => {
					if (destroyed || label.InputAction === undefined) return;
					destroyed = true;
					input.Destroy();
				});
				defer(() => connection.Disconnect());
				jump.AttachLabel(label);
				eventually(() => destroyed, "the change signal ran");
				frames(1);
				expectEqual(
					label.InputAction,
					undefined,
					`signals ${expectedSignalBehavior()}: "the root handle's Destroy" lets go of it; it points at ${pointsAt(label)} (the action ${action.Parent === undefined ? "is destroyed" : "is still there"})`,
				);
			});

			// ---- the swap

			test("a label cleared by hand before the swap stays cleared; the handle still owns it", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const jump = input.Hl2Swap.Actions.Jump;
				const detach = jump.AttachLabel(label);
				label.InputAction = undefined;
				swapNow(copy);
				expectTrue(input.Hl2Swap.IsLinkedToServer(), "swapped in this thread");
				expectEqual(label.InputAction, undefined, `after the swap: ${pointsAt(label)}`);
				detach();
				expectEqual(label.InputAction, undefined, pointsAt(label));
				jump.AttachLabel(label);
				expectEqual(label.InputAction, copy.actions.get("Jump"), pointsAt(label));
			});

			test("two root handles on one stand-in: the owner destroyed before the swap clears the label, and the swap leaves it", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				first.Hl2Swap.Actions.Jump.AttachLabel(label);
				second.Hl2Swap.Actions.Jump.AttachLabel(label);
				second.Destroy();
				expectEqual(label.InputAction, undefined, `the owner's Destroy: ${pointsAt(label)}`);
				swapNow(copy);
				expectTrue(first.Hl2Swap.IsLinkedToServer(), "swapped");
				expectEqual(label.InputAction, undefined, `after the swap: ${pointsAt(label)}`);
			});

			test("a stand-in's label taken over by a root handle on the copy stays on the copy; the stand-in's function leaves it", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy(["Jump"]);
				const waiting = createSwap(copy.folder.Name);
				const detachWaiting = waiting.Hl2Swap.Actions.Jump.AttachLabel(label);
				copy.folder.Parent = Players.LocalPlayer;
				const onCopy = InputActions.Create(HL2_SMALL_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
				});
				defer(() => onCopy.Destroy());
				expectTrue(onCopy.Hl2Swap.IsLinkedToServer(), "linked at Create");
				expectFalse(waiting.Hl2Swap.IsLinkedToServer(), "the copy lacks Duck");
				const jumpCopy = copy.actions.get("Jump")!;
				onCopy.Hl2Swap.Actions.Jump.AttachLabel(label);
				expectEqual(label.InputAction, jumpCopy);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				createSwap(copy.folder.Name);
				expectTrue(waiting.Hl2Swap.IsLinkedToServer(), "swapped once Duck is there");
				detachWaiting();
				waiting.Destroy();
				expectEqual(label.InputAction, jumpCopy, pointsAt(label));
			});

			test("a label attached from a listener the swap's events run (to an action not moved yet) ends on the copy", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const { Jump, Duck } = input.Hl2Swap.Actions;
				Jump.Fire(true);
				eventually(() => Jump.IsPressed(), "held on the stand-in");
				// the stand-in's Pressed reaches the handle first (Deferred), so the swap has a press to release
				frames(2);
				let attachedFrom = "";
				const connection = Jump.Released.Connect(() => {
					if (attachedFrom !== "") return;
					attachedFrom = `Duck on ${Duck.Instance.GetFullName()}`;
					Duck.AttachLabel(label);
				});
				defer(() => connection.Disconnect());
				swapNow(copy);
				eventually(() => attachedFrom !== "", "the swap released Jump");
				frames(2);
				expectEqual(
					label.InputAction,
					copy.actions.get("Duck"),
					`signals ${expectedSignalBehavior()}, attached to ${attachedFrom}: ${pointsAt(label)}`,
				);
			});

			// HL2-2 (hunter, fixed: every handle is marked linked before the swap runs any listener again; Immediate signals only): the swap passed on the copy's events (the refired held value) before the handle was marked linked: a listener saw the action and the context on the copy but IsLinkedToServer() false
			test("the events the swap passes on from the copy come with the handle linked", () => {
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const context = input.Hl2Swap;
				const jump = context.Actions.Jump;
				const jumpCopy = copy.actions.get("Jump")!;
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "held on the stand-in");
				frames(2);
				const seen = new Array<string>();
				const inconsistent = new Array<string>();
				let calls = 0;
				const record = (event: string) => {
					const actionOnCopy = jump.Instance === jumpCopy;
					const contextOnCopy = context.Instance === copy.context;
					const linked = context.IsLinkedToServer();
					const entry = `${event} (action on copy ${actionOnCopy}, context on copy ${contextOnCopy}, linked ${linked})`;
					seen.push(entry);
					if ((actionOnCopy || contextOnCopy) && !linked) {
						inconsistent.push(entry);
						// registered while not linked: must still be called once
						context.WhenLinkedToServer(() => calls++);
					}
				};
				const connections = [
					jump.Pressed.Connect(() => record("Pressed")),
					jump.Released.Connect(() => record("Released")),
					jump.StateChanged.Connect((value) => record(`StateChanged ${value}`)),
				];
				defer(() => connections.forEach((connection) => connection.Disconnect()));
				swapNow(copy);
				expectTrue(context.IsLinkedToServer(), "swapped in this thread");
				eventually(() => jump.IsPressed(), "held on the copy");
				frames(3);
				expectEqual(
					calls,
					inconsistent.size(),
					"each WhenLinkedToServer registered then is called once",
				);
				expectEqual(
					inconsistent.size(),
					0,
					`signals ${expectedSignalBehavior()}: IsLinkedToServer() is "whether the handle wraps the server's copy"; events: ${seen.join("; ")}`,
				);
			});

			// ---- a root handle destroyed by a listener inside the swap (Immediate signals)

			/**
			 * Two root handles on one stand-in; `second` is destroyed before the swap (`midSwap` false)
			 * or by a Released listener the swap runs (`midSwap` true: Immediate signals only). Then J
			 * is held through the binding the swap moved under the copy, and `first`, the last live
			 * root handle, is destroyed: "an action that stays after Destroy ... and is still not at
			 * rest once the package's bindings are gone is reset". Returns the copy's Jump state after.
			 */
			const lastDestroyWithKeyHeld = (midSwap: boolean): [boolean, string] | string => {
				const real = realInput();
				if (typeIs(real, "string")) return real;
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const jump = first.Hl2Swap.Actions.Jump;
				const jumpCopy = copy.actions.get("Jump")!;
				let destroyedIn = "not destroyed";
				if (midSwap) {
					jump.Fire(true);
					eventually(() => jump.IsPressed(), "held on the stand-in");
					frames(2);
					const connection = jump.Released.Connect(() => {
						if (destroyedIn !== "not destroyed") return;
						destroyedIn = `destroyed with first on ${jump.Instance.GetFullName()}, linked ${first.Hl2Swap.IsLinkedToServer()}`;
						second.Destroy();
					});
					defer(() => connection.Disconnect());
				} else {
					second.Destroy();
					destroyedIn = "destroyed before the swap";
				}
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => first.Hl2Swap.IsLinkedToServer(), "linked");
				expectEqual(jump.Instance, jumpCopy);
				jump.Fire(false);
				eventually(() => !jump.IsPressed(), "the scripted value let go");
				real.Press(K.J);
				eventually(
					() => jumpCopy.GetState() === true,
					`J holds the copy's Jump${real.FocusNote()}`,
				);
				first.Destroy();
				frames(3);
				const state = jumpCopy.GetState() === true;
				real.Release(K.J);
				return [
					state,
					`${destroyedIn}; second linked ${second.Hl2Swap.IsLinkedToServer()}, its Jump on ${second.Hl2Swap.Actions.Jump.Instance.GetFullName()}${real.FocusNote()}`,
				];
			};

			test("control: with the other root handle destroyed before the swap, the last one's Destroy resets a key-held action", () => {
				if (expectedSignalBehavior() !== "Immediate")
					return skip("paired with the Immediate-only test below");
				const result = lastDestroyWithKeyHeld(false);
				if (typeIs(result, "string")) return skip(result);
				expectFalse(result[0], `the copy's Jump stays held after the last Destroy: ${result[1]}`);
			});

			// HL2-3 (hunter, fixed: a root handle destroyed during the swap takes no further part in it; Immediate signals only): LinkStandIn still linked it afterwards: it took uses of the copy it never gave back, so the last live root handle's Destroy treated the action as shared and left a key-held action stuck
			test("a root handle destroyed by a listener during the swap leaves no use of the copy behind: the last one's Destroy resets a key-held action", () => {
				if (expectedSignalBehavior() !== "Immediate")
					return skip("listeners run inside the swap under Immediate signals only");
				const result = lastDestroyWithKeyHeld(true);
				if (typeIs(result, "string")) return skip(result);
				expectFalse(result[0], `the copy's Jump stays held after the last Destroy: ${result[1]}`);
			});

			// ---- NotifyLinked: listeners that change other root handles during the notify loop

			test("WhenLinkedToServer: a callback registering on a later root handle gets it called once; one cancelling a later call stops it", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const third = createSwap(copy.folder.Name);
				let secondCalls = 0;
				let thirdCalls = 0;
				let thirdAtOnce = -1;
				const cancelSecond = second.Hl2Swap.WhenLinkedToServer(() => secondCalls++);
				first.Hl2Swap.WhenLinkedToServer(() => {
					cancelSecond();
					third.Hl2Swap.WhenLinkedToServer(() => thirdCalls++);
					thirdAtOnce = thirdCalls;
				});
				swapNow(copy);
				eventually(() => thirdAtOnce !== -1, "the first callback ran");
				frames(3);
				expectEqual(
					`at once ${thirdAtOnce}, then ${thirdCalls}; second ${secondCalls}`,
					"at once 1, then 1; second 0",
					`signals ${expectedSignalBehavior()}`,
				);
			});

			// HL2-4 (hunter): under Deferred signals, a LinkedToServer listener of a root handle destroyed
			// after the swap fired it, before Roblox delivered it, still runs after Destroy.
			// DISPUTED HL2-4, worker: destroying a BindableEvent doesn't take back a delivery on its way,
			// while disconnecting a connection does (hunter-label's cancel test, and the disconnected
			// listeners below). The package holds no connection of the user's listeners, so only custom
			// signal objects in place of the handles' RBXScriptSignals could skip such a call, and that
			// breaks code that treats them as RBXScriptSignals (typeIs, Wait). It concerns every handle
			// signal the same way (StateChanged, Pressed, Released, EnabledChanged, BindingsChanged).
			// docs/Advanced.md (Get-or-create in detail), docs/API.md and the IInputRoot.Destroy JSDoc
			// now say that such an event still arrives, and to disconnect first when it matters;
			// WhenLinkedToServer's own callbacks never run after Destroy. The tests check that.
			test("WhenLinkedToServer: a callback destroying a later root handle: its LinkedToServer still on its way arrives (Deferred), a disconnected listener's doesn't", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				let secondHeard = 0;
				let disconnectedHeard = 0;
				let destroyedIn = false;
				const order = new Array<string>();
				const connection = second.Hl2Swap.LinkedToServer.Connect(() => {
					secondHeard++;
					order.push(`second's listener (second destroyed already: ${destroyedIn})`);
				});
				defer(() => connection.Disconnect());
				const disconnected = second.Hl2Swap.LinkedToServer.Connect(() => disconnectedHeard++);
				defer(() => disconnected.Disconnect());
				first.Hl2Swap.WhenLinkedToServer(() => {
					order.push("first's callback destroys second");
					destroyedIn = true;
					disconnected.Disconnect();
					second.Destroy();
				});
				swapNow(copy);
				eventually(() => destroyedIn, "the first callback ran");
				frames(3);
				const immediate = expectedSignalBehavior() === "Immediate";
				expectEqual(
					secondHeard,
					immediate ? 0 : 1,
					`signals ${expectedSignalBehavior()}: under Immediate second is destroyed before it fires; under Deferred its delivery was on its way: ${order.join(", ")}`,
				);
				expectEqual(disconnectedHeard, 0, "a listener disconnected before the delivery");
				expectTrue(first.Hl2Swap.IsLinkedToServer());
			});

			// HL2-4 (hunter), DISPUTED (see above): under Deferred signals, LinkedToServer listeners of a root handle destroyed right after the swap (same frame) still run, after Destroy
			test("LinkedToServer: a root handle destroyed right after the swap: a delivery on its way arrives (Deferred), a listener disconnected first gets nothing", () => {
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				let heard = 0;
				let disconnectedHeard = 0;
				let destroyed = false;
				const order = new Array<string>();
				const connection = input.Hl2Swap.LinkedToServer.Connect(() => {
					heard++;
					order.push(`listener (destroyed already: ${destroyed})`);
				});
				defer(() => connection.Disconnect());
				const disconnected = input.Hl2Swap.LinkedToServer.Connect(() => disconnectedHeard++);
				defer(() => disconnected.Disconnect());
				const fromCopy = swapNow(copy);
				expectTrue(input.Hl2Swap.IsLinkedToServer(), "swapped in this thread");
				const heardBefore = heard;
				disconnected.Disconnect();
				input.Destroy();
				destroyed = true;
				frames(3);
				expectTrue(fromCopy.Hl2Swap.IsLinkedToServer(), "the other root handle is on the copy");
				const immediate = expectedSignalBehavior() === "Immediate";
				expectEqual(
					`${heardBefore} in the swap, ${heard - heardBefore} after Destroy`,
					immediate ? "1 in the swap, 0 after Destroy" : "0 in the swap, 1 after Destroy",
					`signals ${expectedSignalBehavior()}: ${order.join(", ")}`,
				);
				expectEqual(
					disconnectedHeard,
					immediate ? 1 : 0,
					"the listener disconnected before Destroy: in the swap under Immediate, never under Deferred",
				);
			});

			test("WhenLinkedToServer: a callback attaching a label owned by a later root handle's action takes it over", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const detachSecond = second.Hl2Swap.Actions.Duck.AttachLabel(label);
				let done = false;
				first.Hl2Swap.WhenLinkedToServer(() => {
					first.Hl2Swap.Actions.Jump.AttachLabel(label);
					done = true;
				});
				swapNow(copy);
				eventually(() => done, "the callback ran");
				detachSecond();
				second.Destroy();
				expectEqual(label.InputAction, copy.actions.get("Jump"), pointsAt(label));
			});
		});
	}
}
