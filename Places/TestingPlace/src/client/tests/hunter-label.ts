import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frames, newFolder } from "./helpers";
import { testGui } from "./virtual";

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

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = ReplicatedStorage.WaitForChild(SA_REMOTE, 10) as RemoteFunction | undefined;
	if (remote === undefined) error(`no ${SA_REMOTE}`);
	return remote.InvokeServer(...args) as unknown;
}

/** Where a label points, for a failure message */
function pointsAt(label: InputActionLabel) {
	const action = label.InputAction;
	return action === undefined ? "nothing" : action.GetFullName();
}

/** What a label shows, for a comparison or a failure message */
function shows(label: InputActionLabel) {
	const image = label.ResolvedImageContent;
	return `text "${label.ResolvedText}", image ${image.SourceType.Name} ${image.Uri ?? ""}`;
}

/** Whether a label shows a keybind: text, or an image (an empty Content is SourceType None) */
function showsSomething(label: InputActionLabel) {
	return (
		label.ResolvedText !== "" ||
		label.ResolvedImageContent.SourceType !== Enum.ContentSourceType.None
	);
}

const HL_SCHEMA = InputActions.Schema({
	HlSwap: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: K.J }),
			Duck: InputActions.Bool({ KeyboardAndMouse: K.H }),
		},
	},
});

/** One key, plain, with a DisplayName, and with a DisplayImage */
const DISPLAY_SCHEMA = InputActions.Schema({
	HlDisplay: {
		Actions: {
			Plain: InputActions.Bool({ KeyboardAndMouse: K.J, Gamepad: K.ButtonY }),
			Named: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.J, DisplayName: "Hop" },
				Gamepad: { KeyCode: K.ButtonY, DisplayName: "Hop" },
			}),
			Imaged: InputActions.Bool({
				KeyboardAndMouse: { KeyCode: K.J, DisplayImage: "rbxassetid://6031094678" },
				Gamepad: { KeyCode: K.ButtonY, DisplayImage: "rbxassetid://6031094678" },
			}),
		},
	},
});

/** The same context with Jump only: a root handle on it is satisfied by a copy without Duck */
const HL_SMALL_SCHEMA = InputActions.Schema({
	HlSwap: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});

let copyCount = 0;

/**
 * A copy of `HlSwap` built by hand under a player folder no server provides, as the server's would
 * be: the folder, the context and its Bool actions, not parented to the player yet
 */
function handMadeCopy(actionNames: string[] = ["Jump", "Duck"]) {
	copyCount++;
	const folder = new Instance("Folder");
	folder.Name = `HunterLabelCopy${copyCount}`;
	const context = new Instance("InputContext");
	context.Name = "HlSwap";
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
	const input = InputActions.Create(HL_SCHEMA, {
		Folder: folder,
		PlayerFolderName: folderName,
		Timeout: 1000,
	});
	defer(() => input.Destroy());
	return input;
}

/** Hunt: `AttachLabel` and `WhenLinkedToServer` (0.6.1), adversarial */
@Provider({ activeIn: ["testing"] })
export class HunterLabelTests implements OnStart {
	onStart() {
		defineTests("hunter-label", () => {
			// ---- labels on an action two root handles share (get-or-create)

			// HL-1 (hunter, fixed: the last AttachLabel owns a label; an earlier one lets go without touching it): one root handle letting go clears a label another root handle still has attached
			test("two root handles on one action, the same label attached by both: one letting go leaves it on the action", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const jump = first.Gameplay.Actions.Jump;
				expectEqual(jump.Instance, second.Gameplay.Actions.Jump.Instance, "one shared action");
				const detachFirst = jump.AttachLabel(label);
				second.Gameplay.Actions.Jump.AttachLabel(label);
				detachFirst();
				expectEqual(
					label.InputAction,
					jump.Instance,
					`the second root handle still has the label attached; it points at ${pointsAt(label)}`,
				);
			});

			// HL-1 (hunter, fixed: the last AttachLabel owns a label; an earlier one lets go without touching it): Destroy of one root handle clears a label another live root handle has attached
			test("two root handles on one action, the same label attached by both: Destroy of one leaves it on the action", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const jump = second.Gameplay.Actions.Jump;
				first.Gameplay.Actions.Jump.AttachLabel(label);
				jump.AttachLabel(label);
				first.Destroy();
				expectTrue(jump.Instance.Parent !== undefined, "the action stays with the second handle");
				expectEqual(
					label.InputAction,
					jump.Instance,
					`"destroying one handle leaves what another still uses"; the label points at ${pointsAt(label)}`,
				);
			});

			test("a label one root handle attached is left alone by the Destroy of another root handle on the action", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				first.Gameplay.Actions.Jump.AttachLabel(label);
				second.Destroy();
				expectEqual(label.InputAction, first.Gameplay.Actions.Jump.Instance, pointsAt(label));
			});

			// ---- a label attached elsewhere before the swap

			// HL-2 (hunter, fixed: the swap moves a label only while it is on the stand-in's action): the swap re-points a label that was attached to another action since
			test("a label attached to a stand-in's action, then to another action, stays on the other one at the swap", () => {
				const attached = newLabel();
				if (typeIs(attached, "string")) return skip(attached);
				const pointed = newLabel();
				if (typeIs(pointed, "string")) return skip(pointed);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const localInput = createTestInput();
				const crouch = localInput.Gameplay.Actions.Crouch;
				// the last AttachLabel wins: Crouch
				input.HlSwap.Actions.Jump.AttachLabel(attached);
				crouch.AttachLabel(attached);
				expectEqual(attached.InputAction, crouch.Instance);
				// pointed elsewhere by hand, as "a label repointed elsewhere is left alone when let go"
				input.HlSwap.Actions.Jump.AttachLabel(pointed);
				pointed.InputAction = crouch.Instance;

				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => input.HlSwap.IsLinkedToServer(), "linked");
				expectEqual(input.HlSwap.Actions.Jump.Instance, copy.actions.get("Jump"));
				expectEqual(
					attached.InputAction,
					crouch.Instance,
					`attached to Crouch after Jump, the label points at ${pointsAt(attached)} after the swap`,
				);
				expectEqual(
					pointed.InputAction,
					crouch.Instance,
					`pointed at Crouch by hand, the label points at ${pointsAt(pointed)} after the swap`,
				);
			});

			// HL-2 (hunter, fixed: the swap moves a label only while it is on the stand-in's action): two actions of one stand-in: the swap leaves the label on whichever it moves last
			test("a label attached to two actions of one stand-in in turn ends on the last one at the swap", () => {
				const jumpThenDuck = newLabel();
				if (typeIs(jumpThenDuck, "string")) return skip(jumpThenDuck);
				const duckThenJump = newLabel();
				if (typeIs(duckThenJump, "string")) return skip(duckThenJump);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const { Jump, Duck } = input.HlSwap.Actions;
				Jump.AttachLabel(jumpThenDuck);
				Duck.AttachLabel(jumpThenDuck);
				Duck.AttachLabel(duckThenJump);
				Jump.AttachLabel(duckThenJump);
				expectEqual(jumpThenDuck.InputAction, Duck.Instance);
				expectEqual(duckThenJump.InputAction, Jump.Instance);

				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => input.HlSwap.IsLinkedToServer(), "linked");
				const jumpCopy = copy.actions.get("Jump")!;
				const duckCopy = copy.actions.get("Duck")!;
				expectEqual(
					`${pointsAt(jumpThenDuck)} | ${pointsAt(duckThenJump)}`,
					`${duckCopy.GetFullName()} | ${jumpCopy.GetFullName()}`,
					"each label on the action it was attached to last",
				);
			});

			// ---- labels across the swap

			test("labels of two root handles on one stand-in both follow the swap; one destroyed before it keeps nothing", () => {
				const kept = newLabel();
				if (typeIs(kept, "string")) return skip(kept);
				const gone = newLabel();
				if (typeIs(gone, "string")) return skip(gone);
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const standIn = first.HlSwap.Actions.Jump.Instance;
				expectEqual(second.HlSwap.Actions.Jump.Instance, standIn, "one stand-in");
				first.HlSwap.Actions.Jump.AttachLabel(gone);
				second.HlSwap.Actions.Duck.AttachLabel(kept);
				first.Destroy();
				expectEqual(gone.InputAction, undefined, "the destroyed handle let go");
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => second.HlSwap.IsLinkedToServer(), "linked");
				expectEqual(kept.InputAction, copy.actions.get("Duck"), pointsAt(kept));
				expectEqual(gone.InputAction, undefined, `left alone: ${pointsAt(gone)}`);
			});

			test("a stand-in swapped onto a copy another root handle uses already (bindings adopted): labels end on the copy", () => {
				const early = newLabel();
				if (typeIs(early, "string")) return skip(early);
				const late = newLabel();
				if (typeIs(late, "string")) return skip(late);
				// the copy has Jump only at first: the root handle that needs Duck waits on a stand-in
				const copy = handMadeCopy(["Jump"]);
				const waiting = createSwap(copy.folder.Name);
				waiting.HlSwap.Actions.Jump.AttachLabel(early);
				copy.folder.Parent = Players.LocalPlayer;
				const onCopy = InputActions.Create(HL_SMALL_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
				});
				defer(() => onCopy.Destroy());
				expectTrue(onCopy.HlSwap.IsLinkedToServer(), "the small schema is linked at Create");
				expectFalse(waiting.HlSwap.IsLinkedToServer(), "the copy lacks Duck");
				onCopy.HlSwap.Actions.Jump.AttachLabel(late);
				const duck = new Instance("InputAction");
				duck.Name = "Duck";
				duck.Parent = copy.context;
				eventually(() => waiting.HlSwap.IsLinkedToServer(), "linked once Duck is there");
				const jumpCopy = copy.actions.get("Jump")!;
				expectEqual(waiting.HlSwap.Actions.Jump.Instance, jumpCopy);
				expectEqual(early.InputAction, jumpCopy, pointsAt(early));
				expectEqual(late.InputAction, jumpCopy, pointsAt(late));
				waiting.Destroy();
				expectEqual(
					late.InputAction,
					jumpCopy,
					`the other handle's label stays: ${pointsAt(late)}`,
				);
			});

			test("a label destroyed before the swap is let go of, and the swap leaves it alone", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const standIn = input.HlSwap.Actions.Jump.Instance;
				input.HlSwap.Actions.Jump.AttachLabel(label);
				label.Destroy();
				frames(2);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => input.HlSwap.IsLinkedToServer(), "linked");
				expectTrue(
					label.InputAction === standIn || label.InputAction === undefined,
					`the destroyed label points at ${pointsAt(label)}`,
				);
			});

			test("after the swap the label shows the copy's keybind", () => {
				if (getProject() === "touch") return skip("Jump has no touch binding to show");
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				label.Parent = testGui("HunterLabelGui");
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const jump = input.HlSwap.Actions.Jump;
				jump.AttachLabel(label);
				eventually(() => showsSomething(label), "the label shows the stand-in's keybind");
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => input.HlSwap.IsLinkedToServer(), "linked");
				eventually(
					() => showsSomething(label) && label.InputAction === copy.actions.get("Jump"),
					`the label shows the copy's keybind (${label.ResolvedText}, on ${pointsAt(label)})`,
				);
				const before = label.ResolvedText;
				jump.Bindings.KeyboardAndMouse.Set(K.G);
				eventually(
					() => label.ResolvedText !== before,
					`the label follows a rebind on the copy (still "${label.ResolvedText}")`,
				);
			});

			test("a label the user pointed at the same action first is attached, and cleared when let go", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const jump = createTestInput().Gameplay.Actions.Jump;
				label.InputAction = jump.Instance;
				const detach = jump.AttachLabel(label);
				expectEqual(label.InputAction, jump.Instance);
				detach();
				expectEqual(label.InputAction, undefined, pointsAt(label));
			});

			test("AttachLabel on a destroyed root handle points nothing; a detach after Destroy leaves the label alone", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				const detach = jump.AttachLabel(label);
				input.Destroy();
				expectEqual(label.InputAction, undefined, "Destroy let go");
				const other = createTestInput().Gameplay.Actions.Crouch;
				other.AttachLabel(label);
				detach();
				expectEqual(label.InputAction, other.Instance, pointsAt(label));
				const none = jump.AttachLabel(label);
				expectEqual(label.InputAction, other.Instance, `after Destroy: ${pointsAt(label)}`);
				none();
				expectEqual(label.InputAction, other.Instance);
			});

			// ---- WhenLinkedToServer

			// Passes: under Deferred, a cancel between the swap and the deferred call stops the call (Roblox skips a disconnected pending handler)
			test("WhenLinkedToServer: cancelled after the swap, before its deferred call, the call never comes", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				let calls = 0;
				const cancel = first.HlSwap.WhenLinkedToServer(() => calls++);
				copy.folder.Parent = Players.LocalPlayer;
				// A Create on the same player folder swaps the waiting stand-in, in this thread
				createSwap(copy.folder.Name);
				expectTrue(first.HlSwap.IsLinkedToServer(), "swapped by the second Create");
				const before = calls;
				if (expectedSignalBehavior() === "Immediate") expectEqual(before, 1, "called in the swap");
				cancel();
				frames(3);
				expectEqual(
					calls,
					before,
					`cancelled with ${before} calls made, IsLinkedToServer() already true; then ${calls}`,
				);
			});

			test("WhenLinkedToServer: Destroy after the swap, before its deferred call, ends the call", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				let calls = 0;
				first.HlSwap.WhenLinkedToServer(() => calls++);
				copy.folder.Parent = Players.LocalPlayer;
				createSwap(copy.folder.Name);
				const before = calls;
				first.Destroy();
				frames(3);
				expectEqual(calls, before, `${before} calls before Destroy, ${calls} after`);
			});

			test("WhenLinkedToServer: in the callback the handle is linked, wraps the copy, its labels and actions are on it", () => {
				const label = newLabel();
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				const context = input.HlSwap;
				if (!typeIs(label, "string")) context.Actions.Jump.AttachLabel(label);
				const seen = new Array<string>();
				let nested = -1;
				context.WhenLinkedToServer((instance) => {
					seen.push(`linked ${context.IsLinkedToServer()}`);
					seen.push(`instance ${instance === copy.context} ${context.Instance === copy.context}`);
					seen.push(`action ${context.Actions.Jump.Instance === copy.actions.get("Jump")}`);
					if (!typeIs(label, "string"))
						seen.push(`label ${label.InputAction === copy.actions.get("Jump")}`);
					// asked again from inside: linked now, so at once
					let inner = 0;
					context.WhenLinkedToServer(() => inner++);
					nested = inner;
				});
				const inHandler = new Array<number>();
				context.LinkedToServer.Connect(() => {
					let calls = 0;
					context.WhenLinkedToServer(() => calls++);
					inHandler.push(calls);
				});
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => seen.size() > 0 && inHandler.size() > 0, "the callbacks");
				const expected = ["linked true", "instance true true", "action true"];
				if (!typeIs(label, "string")) expected.push("label true");
				expectEqual(seen.join(", "), expected.join(", "));
				expectEqual(nested, 1, "a nested WhenLinkedToServer is called at once");
				expectEqual(inHandler[0], 1, "WhenLinkedToServer inside LinkedToServer is called at once");
			});

			// HL-3 (hunter, fixed: every handle is marked linked before any fires; Immediate signals only): in the callback, another root handle on the same stand-in wraps the copy but IsLinkedToServer() is false
			test("WhenLinkedToServer: in the callback, another root handle on the same stand-in is linked too", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const seen = new Array<string>();
				first.HlSwap.WhenLinkedToServer(() => {
					seen.push(
						`second: linked ${second.HlSwap.IsLinkedToServer()}, on the copy ${second.HlSwap.Instance === copy.context}`,
					);
				});
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => seen.size() > 0, "the callback");
				expectEqual(
					seen[0],
					"second: linked true, on the copy true",
					`signals ${expectedSignalBehavior()}`,
				);
			});

			test("WhenLinkedToServer: a callback that errors breaks neither the others nor the swap of another root handle", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				first.HlSwap.WhenLinkedToServer(() => {
					error("hunter-label: a callback that errors (expected in the output)");
				});
				let firstCalls = 0;
				first.HlSwap.WhenLinkedToServer(() => firstCalls++);
				let secondCalls = 0;
				second.HlSwap.WhenLinkedToServer(() => secondCalls++);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => first.HlSwap.IsLinkedToServer(), "first linked");
				eventually(
					() => firstCalls === 1 && secondCalls === 1 && second.HlSwap.IsLinkedToServer(),
					`the other callbacks (${firstCalls}, ${secondCalls}), second linked ${second.HlSwap.IsLinkedToServer()}`,
				);
				expectEqual(first.HlSwap.Actions.Jump.Instance, copy.actions.get("Jump"));
			});

			test("WhenLinkedToServer: a callback that errors when linked already throws in the caller's thread", () => {
				const copy = handMadeCopy();
				copy.folder.Parent = Players.LocalPlayer;
				const input = createSwap(copy.folder.Name);
				expectTrue(input.HlSwap.IsLinkedToServer());
				const [ok] = pcall(() =>
					input.HlSwap.WhenLinkedToServer(() => {
						error("hunter-label: thrown in the caller's thread");
					}),
				);
				expectFalse(ok, "the error reaches the caller");
				let calls = 0;
				input.HlSwap.WhenLinkedToServer(() => calls++);
				expectEqual(calls, 1, "still works after");
			});

			test("WhenLinkedToServer: cancel after the call, and twice, does nothing", () => {
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				let calls = 0;
				const cancel = input.HlSwap.WhenLinkedToServer(() => calls++);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => calls === 1, "called");
				cancel();
				cancel();
				frames(2);
				expectEqual(calls, 1);
			});

			test("WhenLinkedToServer: a callback that destroys another root handle on the stand-in leaves the third linked", () => {
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const third = createSwap(copy.folder.Name);
				let secondCalls = 0;
				second.HlSwap.WhenLinkedToServer(() => secondCalls++);
				let thirdCalls = 0;
				third.HlSwap.WhenLinkedToServer(() => thirdCalls++);
				first.HlSwap.WhenLinkedToServer(() => second.Destroy());
				copy.folder.Parent = Players.LocalPlayer;
				eventually(
					() => third.HlSwap.IsLinkedToServer() && thirdCalls === 1,
					`third linked ${third.HlSwap.IsLinkedToServer()}, called ${thirdCalls}`,
				);
				frames(2);
				expectEqual(secondCalls, 0, "the destroyed handle's call never comes");
				expectEqual(third.HlSwap.Actions.Jump.Instance, copy.actions.get("Jump"));
			});

			test("WhenLinkedToServer: a label attached in the callback is on the copy, and stays there", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const input = createSwap(copy.folder.Name);
				input.HlSwap.WhenLinkedToServer(() => input.HlSwap.Actions.Duck.AttachLabel(label));
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => label.InputAction !== undefined, "attached");
				frames(2);
				expectEqual(label.InputAction, copy.actions.get("Duck"), pointsAt(label));
			});

			test("the server's own copy (authority): the label is on it and shows the keybind; WhenLinkedToServer gets it", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				label.Parent = testGui("HunterLabelGui");
				expectTrue(server("provide", "sa") === true, "provided");
				const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
				defer(() => input.Destroy());
				const context = input.SaGameplay;
				const jump = context.Actions.Jump;
				const linkedAtCreate = context.IsLinkedToServer();
				jump.AttachLabel(label);
				const got = new Array<InputContext>();
				context.WhenLinkedToServer((instance) => got.push(instance));
				eventually(() => got.size() === 1, `called (linked at Create: ${linkedAtCreate})`);
				const copy = Players.LocalPlayer.FindFirstChild("Inputs")?.FindFirstChild("SaGameplay");
				expectEqual(got[0], copy, "the server's copy");
				expectEqual(context.Instance, copy);
				expectEqual(label.InputAction, jump.Instance, pointsAt(label));
				expectTrue(jump.Instance.IsDescendantOf(Players.LocalPlayer), pointsAt(label));
				eventually(
					() => showsSomething(label),
					`the label shows the keybind (text "${label.ResolvedText}", on ${pointsAt(label)})`,
				);
				input.Destroy();
				expectEqual(label.InputAction, undefined, `Destroy let go: ${pointsAt(label)}`);
			});

			test("a binding's DisplayName or DisplayImage in the schema changes what the label shows", () => {
				if (getProject() === "touch") return skip("no touch binding: the labels show nothing");
				const gui = testGui("HunterLabelGui");
				const labels = new Array<InputActionLabel>();
				for (let index = 0; index < 3; index++) {
					const label = newLabel();
					if (typeIs(label, "string")) return skip(label);
					label.Position = UDim2.fromOffset(10, 60 + index * 50);
					label.Parent = gui;
					labels.push(label);
				}
				const input = InputActions.Create(DISPLAY_SCHEMA, { Folder: newFolder() });
				defer(() => input.Destroy());
				const { Plain, Named, Imaged } = input.HlDisplay.Actions;
				Plain.AttachLabel(labels[0]);
				Named.AttachLabel(labels[1]);
				Imaged.AttachLabel(labels[2]);
				eventually(
					() => showsSomething(labels[0]) && showsSomething(labels[1]) && showsSomething(labels[2]),
					`all three show something: ${shows(labels[0])} / ${shows(labels[1])} / ${shows(labels[2])}`,
				);
				frames(3);
				const measured = `plain ${shows(labels[0])}; named ${shows(labels[1])}; imaged ${shows(labels[2])}`;
				expectTrue(
					shows(labels[1]) !== shows(labels[0]),
					`DisplayName "Hop" changes it: ${measured}`,
				);
				expectTrue(shows(labels[2]) !== shows(labels[0]), `DisplayImage changes it: ${measured}`);
			});

			// HL-1 (hunter, fixed; Server Authority form): a label one root handle let go of comes back at the swap
			test("two root handles on one stand-in, one label: after one lets go, the swap puts it back", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const copy = handMadeCopy();
				const first = createSwap(copy.folder.Name);
				const second = createSwap(copy.folder.Name);
				const detachFirst = first.HlSwap.Actions.Jump.AttachLabel(label);
				second.HlSwap.Actions.Jump.AttachLabel(label);
				detachFirst();
				const afterDetach = pointsAt(label);
				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => second.HlSwap.IsLinkedToServer(), "linked");
				const afterSwap = pointsAt(label);
				expectEqual(
					afterDetach === "nothing",
					afterSwap === "nothing",
					`the label shows the same before and after the swap: after the detach ${afterDetach}, after the swap ${afterSwap}`,
				);
			});
		});
	}
}
