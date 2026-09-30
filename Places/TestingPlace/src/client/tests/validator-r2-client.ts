import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectArrayEqual,
	expectDefined,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import { Players, StarterPlayer, UserInputService } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frames, newFolder, recordSignal, recordWarnings } from "./helpers";

// Validator round 2: adversarial client tests (shared handles, lifecycle, focus loss, naming,
// RawInputHandler under Server Authority).

const K = Enum.KeyCode;

function bindingsOf(action: Instance) {
	return action.GetChildren().filter((child) => child.IsA("InputBinding"));
}

function newTextBox() {
	const gui = new Instance("ScreenGui");
	gui.Name = "ValidatorR2Focus";
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

/** A folder with a designer's Gameplay.Jump and its `JumpKeyboardAndMouse` binding on F */
function designerFolder() {
	const folder = newFolder();
	const context = new Instance("InputContext");
	context.Name = "Gameplay";
	const jump = new Instance("InputAction");
	jump.Name = "Jump";
	jump.Parent = context;
	const keys = new Instance("InputBinding");
	keys.Name = "JumpKeyboardAndMouse";
	keys.KeyCode = K.F;
	keys.Parent = jump;
	context.Parent = folder;
	return { Folder: folder, Context: context, Jump: jump, Keys: keys };
}

/** A Scriptable binding added to one of the PlayerModule's actions for the test */
function scriptableBinding(action: InputAction, reset: unknown) {
	const binding = new Instance("InputBinding");
	binding.Name = "ValidatorR2Binding";
	binding.Type = Enum.InputBindingType.Scriptable;
	binding.Parent = action;
	defer(() => {
		pcall(() => binding.Fire(reset));
		binding.Destroy();
	});
	return binding;
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR2ClientTests implements OnStart {
	onStart() {
		defineTests("validator-r2", () => {
			// ---- several root handles on one folder (design spec section 4)

			test("destroying the handle whose Fire holds a shared action releases it", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				let destroyed = false;
				defer(() => {
					if (!destroyed) holder.Destroy();
				});
				holder.Gameplay.Actions.Jump.Fire(true);
				expectTrue(keeper.Gameplay.Actions.Jump.IsPressed(), "the holder's Fire presses Jump");
				holder.Destroy();
				destroyed = true;
				frames(3);
				expectFalse(
					keeper.Gameplay.Actions.Jump.IsPressed(),
					"nothing holds Jump once the handle that fired it is destroyed",
				);
			});

			test("after the holder's Destroy, the other handle's Fire(false) releases the action", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				holder.Gameplay.Actions.Jump.Fire(true);
				holder.Destroy();
				const jump = keeper.Gameplay.Actions.Jump;
				jump.Fire(false);
				frames(3);
				expectFalse(jump.IsPressed(), "Fire(false) from the remaining handle lets go");
			});

			test("destroying the holder of a shared Direction2D Fire leaves it at rest", () => {
				const folder = newFolder();
				const keeper = createTestInput(folder);
				const holder = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				holder.Gameplay.Actions.Look.Fire(new Vector2(3, 4));
				expectEqual(keeper.Gameplay.Actions.Look.GetState(), new Vector2(3, 4));
				holder.Destroy();
				frames(3);
				expectEqual(
					keeper.Gameplay.Actions.Look.GetState(),
					Vector2.zero,
					"the destroyed handle's fired value is not left behind",
				);
			});

			test("Destroy twice and handle calls afterwards don't throw", () => {
				const input = InputActions.Create(TEST_SCHEMA, { Folder: newFolder() });
				input.Destroy();
				expectNoThrow(() => input.Destroy(), "a second Destroy");
				const jump = input.Gameplay.Actions.Jump;
				expectNoThrow(() => jump.GetState(), "GetState after Destroy");
				expectNoThrow(() => input.ExportBindings(), "ExportBindings after Destroy");
				expectNoThrow(() => input.Gameplay.ExportBindings(), "a context's ExportBindings");
			});

			test("the root handle holds only the contexts and its five members", () => {
				const input = createTestInput();
				const root = input as unknown as Record<string, unknown>;
				const names = new Array<string>();
				for (const [name] of pairs(root)) names.push(name as string);
				names.sort();
				expectArrayEqual(names, [
					"BindingsChanged",
					"Destroy",
					"ExportBindings",
					"Gameplay",
					"ImportBindings",
					"Menu",
					"ResetBindings",
					"Ui",
				]);
			});

			test("contexts named like runtime internals are plain contexts", () => {
				const schema = InputActions.Schema({
					Build: { Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) } },
					Root: { Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) } },
					Use: { Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: K.P }) } },
				});
				const input = InputActions.Create(schema, { Folder: newFolder() });
				defer(() => input.Destroy());
				input.Build.Actions.Poke.Bindings.KeyboardAndMouse.Set(K.O);
				input.Root.Actions.Poke.Fire(true);
				expectTrue(input.Root.Actions.Poke.GetState());
				input.Root.Actions.Poke.Fire(false);
				input.Use.SetEnabled(false);
				expectFalse(input.Use.Instance.Enabled);
				expectEqual(input.Build.Actions.Poke.Bindings.KeyboardAndMouse.Instance.KeyCode, K.O);
			});

			// ---- focus loss

			test("focus loss with two handles on one folder: one false/true pair each", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const second = createTestInput(folder);
				const firstChanges = recordSignal(first.Gameplay.EnabledChanged);
				const secondChanges = recordSignal(second.Gameplay.EnabledChanged);
				first.Gameplay.Actions.Jump.Fire(true);
				frames(2);
				newTextBox().CaptureFocus();
				eventually(
					() => firstChanges.size() >= 2 && secondChanges.size() >= 2,
					"both handles hear the pair",
				);
				frames(5);
				expectArrayEqual(firstChanges, [false, true]);
				expectArrayEqual(secondChanges, [false, true]);
				expectTrue(first.Gameplay.Instance.Enabled);
				expectFalse(second.Gameplay.Actions.Jump.IsPressed());
			});

			test("Destroy within the focus-loss frame gives an adopted context its base state", () => {
				const { Folder: folder, Context: context } = designerFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				// connected after Create's own handler, so it runs once the hold is on
				let destroyed = false;
				const connection = UserInputService.TextBoxFocused.Connect(() => {
					if (destroyed) return;
					destroyed = true;
					input.Destroy();
				});
				defer(() => connection.Disconnect());
				newTextBox().CaptureFocus();
				eventually(() => destroyed, "the focus event");
				frames(3);
				expectTrue(context.Enabled, "the designer's context is enabled again");
			});

			test("Tap then Destroy before the release frame leaves the adopted action at rest", () => {
				const { Folder: folder, Jump: jumpInstance } = designerFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				input.Gameplay.Actions.Jump.Tap();
				expectTrue(jumpInstance.GetState() as boolean);
				input.Destroy();
				frames(3);
				expectFalse(jumpInstance.GetState() as boolean);
				expectEqual(bindingsOf(jumpInstance).size(), 1, "only the designer's binding");
			});

			// ---- names the package gives its own bindings

			test("a slot named Script doesn't collide with Fire's <Action>Script binding", () => {
				let schema: InputActions.InputSchema<Record<string, InputActions.ContextSchema>>;
				try {
					schema = InputActions.Schema({
						R2Collide: { Actions: { Dash: InputActions.Bool({ Script: K.X }) } },
					}) as never;
				} catch {
					return; // refused by Schema: fine
				}
				const folder = newFolder();
				const input = InputActions.Create(schema, { Folder: folder }) as unknown as Record<
					string,
					{ Actions: Record<string, { Fire(value: boolean): void; Instance: InputAction }> }
				> & { Destroy(): void };
				defer(() => input.Destroy());
				const dash = input.R2Collide.Actions.Dash;
				dash.Fire(true);
				dash.Fire(false);
				const named = bindingsOf(dash.Instance).filter((binding) => binding.Name === "DashScript");
				expectEqual(named.size(), 1, "bindings named DashScript under Dash");
			});

			test("a second Create on a folder whose slot and Fire bindings share a name warns nothing", () => {
				const warnings = recordWarnings();
				// Round 3: Schema refuses the slot name (R2-F4), which settles this case too
				const makeSchema = () =>
					InputActions.Schema({
						R2Collide2: { Actions: { Dash: InputActions.Bool({ Script: K.X }) } },
					});
				let schema: ReturnType<typeof makeSchema>;
				try {
					schema = makeSchema();
				} catch {
					return; // refused by Schema: fine
				}
				const folder = newFolder();
				const first = InputActions.Create(schema, { Folder: folder });
				defer(() => first.Destroy());
				first.R2Collide2.Actions.Dash.Fire(true);
				first.R2Collide2.Actions.Dash.Fire(false);
				const second = InputActions.Create(schema, { Folder: folder });
				defer(() => second.Destroy());
				frames(2);
				// only the package's own warnings (the test runner logs results as warnings too)
				const about = warnings.filter(
					(message) =>
						message.sub(1, 13) === "InputActions:" &&
						message.find("DashScript", 1, true)[0] !== undefined,
				);
				expectEqual(about.join(" | "), "", "warnings naming DashScript");
				expectEqual(
					second.R2Collide2.Actions.Dash.Bindings.Script.Instance.Type,
					Enum.InputBindingType.Automatic,
					"the second handle's slot wraps the key binding",
				);
			});

			// ---- RawInputHandler under Server Authority (design spec section 10)

			test("under Server Authority GetRotation follows the camera action Roblox's CameraModule reads", () => {
				if (getProject() !== "authority") return;
				RawInputHandler.Initialize();
				// CameraModule/CameraInput.luau reads script.Parent.Parent.InputContexts, i.e. the
				// PlayerModule's own contexts, in every mode (External/PlayerModule, line 15)
				const contexts = expectDefined(
					StarterPlayer.WaitForChild("PlayerModule", 10)?.WaitForChild("InputContexts", 10),
					"StarterPlayer.PlayerModule.InputContexts",
				);
				const camera = expectDefined(contexts.WaitForChild("CameraContext", 10)) as InputContext;
				const rotation = expectDefined(
					camera.WaitForChild("CameraRotationAction", 10),
				) as InputAction;
				expectTrue(camera.Enabled, "Roblox's camera context is enabled");
				expectTrue(rotation.Enabled, "Roblox's camera rotation action is enabled");
				const binding = scriptableBinding(rotation, Vector2.zero);
				binding.Fire(new Vector2(10, 0));
				eventually(() => rotation.GetState() === new Vector2(10, 0), "Roblox's camera action moved");
				eventually(
					() => RawInputHandler.GetRotation().X > 0,
					"RawInputHandler's rotation to follow the action the camera reads",
					3,
				);
			});

			// Round 3: this test compared Roblox's two copies of CameraRotationAction with each other, which
			// the package doesn't (and must not) tune, so it could never pass. It now checks what it was
			// after: RawInputHandler doesn't read the player's copy, whose bindings keep the defaults.
			test("under Server Authority RawInputHandler ignores the player's untuned copy of the camera action", () => {
				if (getProject() !== "authority") return;
				RawInputHandler.Initialize();
				const playerAction = expectDefined(
					Players.LocalPlayer.WaitForChild("InputContexts", 10)
						?.WaitForChild("CameraContext", 10)
						?.WaitForChild("CameraRotationAction", 10),
				) as InputAction;
				const binding = scriptableBinding(playerAction, Vector2.zero);
				// read from that copy, even one frame at 240 Hz gives a rotation of 40
				binding.Fire(new Vector2(10000, 0));
				eventually(
					() => playerAction.GetState() === new Vector2(10000, 0),
					"the player's copy to take the value",
				);
				for (let index = 0; index < 10; index++) {
					expectTrue(RawInputHandler.GetRotation().X < 5, "a rotation from the player's copy");
					frames(1);
				}
			});
		});
	}
}
