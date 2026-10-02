import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players } from "@rbxts/services";
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

/** What a label shows, for a failure message */
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

const SWAP_SCHEMA = InputActions.Schema({
	LabelSwap: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	},
});

/**
 * A copy of `LabelSwap` built by hand under the player, as the server's would be (a place without
 * Server Authority links to one too): the folder, the context and its action, not parented yet
 */
function handMadeCopy(folderName: string) {
	const folder = new Instance("Folder");
	folder.Name = folderName;
	const context = new Instance("InputContext");
	context.Name = "LabelSwap";
	const action = new Instance("InputAction");
	action.Name = "Jump";
	action.Parent = context;
	context.Parent = folder;
	defer(() => folder.Destroy());
	return { folder, context, action };
}

/** `AttachLabel` (on every action handle) and `WhenLinkedToServer` (on Server Authority contexts), 0.6.1 */
@Provider({ activeIn: ["testing"] })
export class AttachLabelTests implements OnStart {
	onStart() {
		defineTests("attach-label", () => {
			test("AttachLabel points the label at the action; the returned function lets go and clears it", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const detach = jump.AttachLabel(label);
				expectEqual(label.InputAction, jump.Instance);
				// twice: one attachment, both functions let go of it
				const again = jump.AttachLabel(label);
				expectEqual(label.InputAction, jump.Instance);
				again();
				expectEqual(label.InputAction, undefined);
				detach();
				expectEqual(label.InputAction, undefined);
			});

			test("every action type takes a label", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const actions = createTestInput().Gameplay.Actions;
				for (const action of [actions.Move, actions.Zoom, actions.Fly, actions.Aim, actions.Jump]) {
					const detach = action.AttachLabel(label);
					expectEqual(label.InputAction, action.Instance, action.Name);
					detach();
				}
			});

			test("the label shows the keybind, and follows a rebind", () => {
				// Jump has keyboard and gamepad bindings, none for touch: on a phone it has no preferred
				// binding, and the label rightly shows nothing
				if (getProject() === "touch") return skip("Jump has no touch binding to show");
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				label.Parent = testGui("InputActionsLabels");
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.AttachLabel(label);
				eventually(() => showsSomething(label), `the label shows something (${shows(label)})`);
				const before = shows(label);
				jump.Bindings.KeyboardAndMouse.Set(K.F);
				jump.Bindings.Gamepad.Set(K.ButtonX);
				eventually(() => shows(label) !== before, `the label follows the rebind (was ${before})`);
			});

			test("a label repointed elsewhere is left alone when let go", () => {
				const label = newLabel();
				if (typeIs(label, "string")) return skip(label);
				const actions = createTestInput().Gameplay.Actions;
				const detach = actions.Jump.AttachLabel(label);
				label.InputAction = actions.Crouch.Instance;
				detach();
				expectEqual(label.InputAction, actions.Crouch.Instance);
			});

			test("Destroy lets go of the labels; a label destroyed first is let go of; a destroyed label gets nothing", () => {
				const first = newLabel();
				if (typeIs(first, "string")) return skip(first);
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				jump.AttachLabel(first);
				input.Destroy();
				expectEqual(first.InputAction, undefined, "Destroy cleared it");

				const second = newLabel();
				if (typeIs(second, "string")) return skip(second);
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				const detach = crouch.AttachLabel(second);
				second.Destroy();
				frames(2);
				detach(); // let go of already: nothing to do

				const third = newLabel();
				if (typeIs(third, "string")) return skip(third);
				third.Destroy();
				const none = crouch.AttachLabel(third);
				expectEqual(third.InputAction, undefined, "a destroyed label isn't pointed");
				none();
			});

			test("AttachLabel throws on anything but an InputActionLabel", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const untyped = jump as unknown as { AttachLabel: (label: unknown) => () => void };
				expectThrows(() => untyped.AttachLabel(new Instance("TextLabel")));
				expectThrows(() => untyped.AttachLabel(undefined));
			});

			test("the label follows the stand-in swap to the server's copy; WhenLinkedToServer is called then", () => {
				const label = newLabel();
				const copy = handMadeCopy("LabelSwapCopy");
				const input = InputActions.Create(SWAP_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
					Timeout: 1000,
				});
				defer(() => input.Destroy());
				const context = input.LabelSwap;
				const jump = context.Actions.Jump;
				expectFalse(context.IsLinkedToServer());
				if (!typeIs(label, "string")) jump.AttachLabel(label);
				const standIn = jump.Instance;
				const linked = new Array<InputContext>();
				context.WhenLinkedToServer((instance) => linked.push(instance));
				const cancelled = new Array<InputContext>();
				const cancel = context.WhenLinkedToServer((instance) => cancelled.push(instance));
				cancel();
				frames(2);
				expectEqual(linked.size(), 0, "not before the copy arrives");

				copy.folder.Parent = Players.LocalPlayer;
				eventually(() => context.IsLinkedToServer(), "linked");
				eventually(() => linked.size() === 1, "WhenLinkedToServer's callback");
				expectEqual(linked[0], copy.context, "with the server's copy");
				expectEqual(jump.Instance, copy.action);
				if (!typeIs(label, "string")) {
					expectEqual(label.InputAction, copy.action, "the label is on the copy's action");
					expectTrue(label.InputAction !== standIn);
				}
				frames(3);
				expectEqual(linked.size(), 1, "once");
				expectEqual(cancelled.size(), 0, "a cancelled call never comes");

				// asked once linked: called at once, in the caller's thread
				const now = new Array<InputContext>();
				const noop = context.WhenLinkedToServer((instance) => now.push(instance));
				expectEqual(now.size(), 1, "called at once");
				expectEqual(now[0], copy.context);
				noop();
			});

			test("WhenLinkedToServer: called at once when the copy was there at Create; never after Destroy", () => {
				const copy = handMadeCopy("LabelSwapThere");
				copy.folder.Parent = Players.LocalPlayer;
				const input = InputActions.Create(SWAP_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: copy.folder.Name,
				});
				defer(() => input.Destroy());
				expectTrue(input.LabelSwap.IsLinkedToServer(), "linked at Create");
				let calls = 0;
				input.LabelSwap.WhenLinkedToServer(() => calls++);
				expectEqual(calls, 1, "at once");

				const later = handMadeCopy("LabelSwapLater");
				const other = InputActions.Create(SWAP_SCHEMA, {
					Folder: newFolder(),
					PlayerFolderName: later.folder.Name,
					Timeout: 1000,
				});
				let otherCalls = 0;
				other.LabelSwap.WhenLinkedToServer(() => otherCalls++);
				other.Destroy();
				later.folder.Parent = Players.LocalPlayer;
				frames(6);
				expectEqual(otherCalls, 0, "Destroy ends the call to come");
				let afterDestroy = 0;
				other.LabelSwap.WhenLinkedToServer(() => afterDestroy++);
				expectEqual(afterDestroy, 0, "nothing after Destroy");
			});
		});
	}
}
