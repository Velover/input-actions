import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { countSignal, createTestInput, frames, newFolder } from "./helpers";

function newButton(name = "Button") {
	const gui = new Instance("ScreenGui");
	gui.Name = "InputActionsButtonTest";
	gui.ResetOnSpawn = false;
	const button = new Instance("TextButton");
	button.Name = name;
	button.Size = UDim2.fromOffset(80, 80);
	button.Parent = gui;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => gui.Destroy());
	return button;
}

function buttonBindings(action: InputAction) {
	return action
		.GetChildren()
		.filter((child) => child.IsA("InputBinding") && child.UIButton !== undefined);
}

/** AttachButton, and the reset of a binding destroyed while held (design spec §6) */
@Provider({ activeIn: ["testing"] })
export class AttachButtonTests implements OnStart {
	onStart() {
		defineTests("attach-button", () => {
			test("creates an Automatic UIButton binding; the returned function removes it", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = newButton();
				const detach = jump.AttachButton(button);
				const binding = jump.Instance.FindFirstChild("JumpUIButton1") as InputBinding;
				expectTrue(binding !== undefined && binding.IsA("InputBinding"));
				expectEqual(binding.UIButton, button);
				expectEqual(binding.Type, Enum.InputBindingType.Automatic);
				expectEqual(binding.KeyCode, Enum.KeyCode.None);
				detach();
				expectEqual(binding.Parent, undefined);
				expectNoThrow(detach);
			});

			test("several buttons at once", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const detachFirst = jump.AttachButton(newButton("A"));
				const detachSecond = jump.AttachButton(newButton("B"));
				expectEqual(buttonBindings(jump.Instance).size(), 2);
				expectTrue(jump.Instance.FindFirstChild("JumpUIButton2") !== undefined);
				detachFirst();
				expectEqual(buttonBindings(jump.Instance).size(), 1);
				detachSecond();
				expectEqual(buttonBindings(jump.Instance).size(), 0);
			});

			test("destroying the button removes its binding", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = newButton();
				jump.AttachButton(button);
				expectEqual(buttonBindings(jump.Instance).size(), 1);
				button.Destroy();
				eventually(
					() => jump.Instance.FindFirstChild("JumpUIButton1") === undefined,
					"the binding to go",
				);
			});

			test("removing the binding while the action is held releases the action", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const released = countSignal(jump.Released);
				jump.Fire(true);
				frames(2);
				const detach = jump.AttachButton(newButton());
				detach();
				expectFalse(jump.GetState());
				expectTrue(jump.IsEnabled());
				eventually(() => released.count === 1, "Released");
			});

			test("a destroyed button releases a held action too", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const button = newButton();
				jump.AttachButton(button);
				jump.Fire(true);
				frames(2);
				button.Destroy();
				eventually(() => !jump.GetState(), "the release");
			});

			test("a button not parented yet gets its binding; one destroyed already gets none", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const loose = new Instance("TextButton");
				defer(() => loose.Destroy());
				jump.AttachButton(loose);
				expectEqual(buttonBindings(jump.Instance).size(), 1, "the unparented button's binding");
				loose.Destroy();
				eventually(() => buttonBindings(jump.Instance).size() === 0, "removed with the button");

				const gone = newButton();
				gone.Destroy();
				const detach = jump.AttachButton(gone);
				expectEqual(buttonBindings(jump.Instance).size(), 0, "no binding for a destroyed button");
				expectNoThrow(detach);
			});

			test("whatever the button's name, a destroyed one gets no binding and a live one does", () => {
				// The Parent errors that tell them apart hold the name
				const jump = createTestInput().Gameplay.Actions.Jump;
				const names = [
					"Locked",
					"UnlockedDoor",
					"Attempt to set Locked as its own parent",
					"The Parent property of X is locked",
				];
				for (const name of names) {
					const gone = new Instance("TextButton");
					gone.Name = name;
					gone.Destroy();
					jump.AttachButton(gone);
					expectEqual(buttonBindings(jump.Instance).size(), 0, `destroyed "${name}"`);
					const live = new Instance("TextButton");
					live.Name = name;
					defer(() => live.Destroy());
					const detach = jump.AttachButton(live);
					expectEqual(buttonBindings(jump.Instance).size(), 1, `live, unparented "${name}"`);
					detach();
				}
			});

			test("Destroy removes attached bindings", () => {
				const input = InputActions.Create(TEST_SCHEMA, { Folder: newFolder() });
				const jump = input.Gameplay.Actions.Jump;
				jump.AttachButton(newButton());
				const binding = jump.Instance.FindFirstChild("JumpUIButton1");
				expectTrue(binding !== undefined);
				input.Destroy();
				expectEqual(binding!.Parent, undefined);
			});
		});
	}
}
