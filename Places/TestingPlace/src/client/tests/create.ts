import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { TEST_SCHEMA } from "shared/fixtures/schemas";
import { createTestInput, frame, nearlyEqual, newFolder, recordWarnings } from "./helpers";

function child<T extends keyof Instances>(
	parent: Instance,
	name: string,
	className: T,
): Instances[T] {
	const found = parent.FindFirstChild(name);
	expectTrue(
		found !== undefined && found.IsA(className),
		`${parent.GetFullName()}.${name} is a ${className}`,
	);
	return found as Instances[T];
}

function bindingsOf(action: Instance) {
	return action.GetChildren().filter((binding) => binding.IsA("InputBinding"));
}

/** A folder shaped like the Input Action Manager's: bindings named `<Action><Device>` */
function managerFolder() {
	const folder = newFolder();
	const context = new Instance("InputContext");
	context.Name = "Gameplay";
	context.Priority = 1234;
	context.Sink = false;
	context.Enabled = false;
	context.Parent = folder;

	const jump = new Instance("InputAction");
	jump.Name = "Jump";
	jump.DisplayName = "Designer jump";
	jump.Parent = context;
	const jumpKey = new Instance("InputBinding");
	jumpKey.Name = "JumpKeyboardAndMouse";
	jumpKey.KeyCode = Enum.KeyCode.F;
	jumpKey.Parent = jump;
	const jumpPad = new Instance("InputBinding");
	jumpPad.Name = "JumpGamepad";
	jumpPad.KeyCode = Enum.KeyCode.ButtonX;
	jumpPad.Parent = jump;
	// The Manager's default binding name matches no slot
	const stray = new Instance("InputBinding");
	stray.Name = "InputBinding";
	stray.KeyCode = Enum.KeyCode.J;
	stray.Parent = jump;

	const move = new Instance("InputAction");
	move.Name = "Move";
	move.Type = Enum.InputActionType.Direction2D;
	move.Parent = context;
	const moveKeys = new Instance("InputBinding");
	moveKeys.Name = "MoveKeyboardAndMouse";
	moveKeys.Up = Enum.KeyCode.Up;
	moveKeys.Parent = move;
	// Matched by the slot name alone
	const movePad = new Instance("InputBinding");
	movePad.Name = "Gamepad";
	movePad.KeyCode = Enum.KeyCode.Thumbstick2;
	movePad.Parent = move;

	const wave = new Instance("InputAction");
	wave.Name = "Wave";
	wave.Parent = context;

	const other = new Instance("InputContext");
	other.Name = "Other";
	other.Parent = folder;
	return folder;
}

/** Get-or-create against the folder (design spec §4) */
@Provider({ activeIn: ["testing"] })
export class CreateTests implements OnStart {
	onStart() {
		defineTests("create", () => {
			test("creates the whole tree in a fresh folder", () => {
				const folder = newFolder();
				const input = createTestInput(folder);

				const gameplay = child(folder, "Gameplay", "InputContext");
				expectEqual(input.Gameplay.Instance, gameplay);
				expectEqual(gameplay.Priority, 2000);
				expectTrue(gameplay.Sink);
				expectTrue(gameplay.Enabled);
				expectFalse(child(folder, "Menu", "InputContext").Enabled);
				expectEqual(child(folder, "Menu", "InputContext").Priority, 1000);
				expectEqual(child(folder, "Ui", "InputContext").Priority, 3000);

				const jump = child(gameplay, "Jump", "InputAction");
				expectEqual(jump.Type, Enum.InputActionType.Bool);
				expectEqual(
					child(jump, "JumpKeyboardAndMouse", "InputBinding").KeyCode,
					Enum.KeyCode.Space,
				);
				expectEqual(child(jump, "JumpGamepad", "InputBinding").KeyCode, Enum.KeyCode.ButtonA);
				expectEqual(bindingsOf(jump).size(), 2);

				const move = child(gameplay, "Move", "InputAction");
				expectEqual(move.Type, Enum.InputActionType.Direction2D);
				const keys = child(move, "MoveKeyboardAndMouse", "InputBinding");
				expectEqual(keys.KeyCode, Enum.KeyCode.None);
				expectEqual(keys.Up, Enum.KeyCode.W);
				expectEqual(keys.Down, Enum.KeyCode.S);
				expectEqual(keys.Left, Enum.KeyCode.A);
				expectEqual(keys.Right, Enum.KeyCode.D);
				const pad = child(move, "MoveGamepad", "InputBinding");
				expectEqual(pad.KeyCode, Enum.KeyCode.Thumbstick1);
				expectEqual(pad.ResponseCurve, 2);
				const virtual = child(move, "MoveVirtual", "InputBinding");
				expectEqual(virtual.Type, Enum.InputBindingType.Scriptable);
				expectEqual(keys.Type, Enum.InputBindingType.Automatic);

				const look = child(child(gameplay, "Look", "InputAction"), "LookMouse", "InputBinding");
				expectEqual(look.KeyCode, Enum.KeyCode.MouseDelta);
				expectTrue(nearlyEqual(look.Scale, 0.02));
				expectEqual(look.Vector2Scale, new Vector2(1, -1));

				const fire = child(child(gameplay, "Fire", "InputAction"), "FireGamepad", "InputBinding");
				expectTrue(nearlyEqual(fire.PressedThreshold, 0.6));
				const save = child(
					child(gameplay, "QuickSave", "InputAction"),
					"QuickSaveKeyboardAndMouse",
					"InputBinding",
				);
				expectEqual(save.KeyCode, Enum.KeyCode.S);
				expectEqual(save.PrimaryModifier, Enum.KeyCode.LeftControl);
				const fly = child(child(gameplay, "Fly", "InputAction"), "FlyKeyboard", "InputBinding");
				expectEqual(fly.Forward, Enum.KeyCode.W);
				expectEqual(fly.Down, Enum.KeyCode.LeftControl);

				const dash = child(gameplay, "Dash", "InputAction");
				expectEqual(dash.DisplayName, "Dash");
				expectEqual(bindingsOf(dash).size(), 0);
			});

			test("handles name their instances", () => {
				const input = createTestInput();
				const jump = input.Gameplay.Actions.Jump;
				expectEqual(input.Gameplay.Name, "Gameplay");
				expectEqual(jump.Name, "Jump");
				expectEqual(jump.Type, Enum.InputActionType.Bool);
				expectEqual(jump.Instance.Name, "Jump");
				expectEqual(jump.Bindings.KeyboardAndMouse.Name, "KeyboardAndMouse");
				expectEqual(jump.Bindings.KeyboardAndMouse.Instance.Name, "JumpKeyboardAndMouse");
				expectEqual(input.Gameplay.Actions.Move.Bindings.Virtual.Name, "Virtual");
				expectEqual(input.Gameplay.Actions.Move.Bindings.Virtual.Instance.Name, "MoveVirtual");
			});

			test("adopts a Manager-shaped folder: what exists wins", () => {
				const folder = managerFolder();
				const gameplay = child(folder, "Gameplay", "InputContext");
				const jump = child(gameplay, "Jump", "InputAction");
				const input = createTestInput(folder);

				expectEqual(input.Gameplay.Instance, gameplay);
				expectEqual(gameplay.Priority, 1234);
				expectFalse(gameplay.Sink);
				expectFalse(gameplay.Enabled);
				expectFalse(input.Gameplay.IsEnabled());
				expectEqual(jump.DisplayName, "Designer jump");

				const jumpKeys = input.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance;
				expectEqual(jumpKeys, jump.FindFirstChild("JumpKeyboardAndMouse"));
				expectEqual(jumpKeys.KeyCode, Enum.KeyCode.F);
				expectEqual(
					input.Gameplay.Actions.Jump.Bindings.Gamepad.Instance.KeyCode,
					Enum.KeyCode.ButtonX,
				);
				// nothing created beside the adopted bindings; the stray one is left alone
				expectEqual(bindingsOf(jump).size(), 3);
				expectEqual(child(jump, "InputBinding", "InputBinding").KeyCode, Enum.KeyCode.J);

				const move = input.Gameplay.Actions.Move;
				expectEqual(move.Bindings.KeyboardAndMouse.Instance.Up, Enum.KeyCode.Up);
				expectEqual(move.Bindings.KeyboardAndMouse.Instance.Down, Enum.KeyCode.None);
				expectEqual(move.Bindings.Gamepad.Instance.Name, "Gamepad");
				expectEqual(move.Bindings.Gamepad.Instance.KeyCode, Enum.KeyCode.Thumbstick2);
				// the missing slot is created
				expectEqual(move.Bindings.Virtual.Instance.Name, "MoveVirtual");

				// actions the folder lacked are created; extras stay
				expectDefined(gameplay.FindFirstChild("Look"));
				expectDefined(gameplay.FindFirstChild("Wave"));
				expectDefined(folder.FindFirstChild("Other"));
			});

			test("warns in Studio about instances the schema doesn't mention", () => {
				const warnings = recordWarnings();
				const folder = managerFolder();
				createTestInput(folder);
				eventually(() => warnings.size() >= 3, "three warnings");
				const joined = warnings.join("\n");
				expectTrue(joined.find("Gameplay.Wave", 1, true)[0] !== undefined, joined);
				expectTrue(joined.find("Inputs.Other", 1, true)[0] !== undefined, joined);
				expectTrue(joined.find("Jump.InputBinding", 1, true)[0] !== undefined, joined);
			});

			test("an adopted binding that breaks the rules is warned about and left as it is", () => {
				const warnings = recordWarnings();
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Parent = context;
				const binding = new Instance("InputBinding");
				binding.Name = "JumpKeyboardAndMouse";
				binding.KeyCode = Enum.KeyCode.MouseDelta;
				binding.Parent = jump;
				context.Parent = folder;

				createTestInput(folder);
				expectEqual(binding.KeyCode, Enum.KeyCode.MouseDelta);
				eventually(
					() =>
						warnings.some(
							(message) => message.find("Gameplay/Jump/KeyboardAndMouse", 1, true)[0] !== undefined,
						),
					"a warning naming the binding",
				);
			});

			test("an existing action of another type throws, naming the path, and leaves nothing behind", () => {
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "Gameplay";
				const jump = new Instance("InputAction");
				jump.Name = "Jump";
				jump.Type = Enum.InputActionType.Direction1D;
				jump.Parent = context;
				context.Parent = folder;

				const message = expectThrows(() => InputActions.Create(TEST_SCHEMA, { Folder: folder }));
				expectTrue(message.find("Gameplay/Jump", 1, true)[0] !== undefined, message);
				expectEqual(folder.GetChildren().size(), 1);
				expectEqual(context.GetChildren().size(), 1);
			});

			test("slots S and <Action>S in a schema made without Schema throw, leaving nothing", () => {
				const folder = newFolder();
				const schema = {
					Contexts: {
						Gameplay: {
							Actions: {
								Jump: InputActions.Bool({ JumpPad: Enum.KeyCode.ButtonB }),
								Dash: InputActions.Bool({ Pad: Enum.KeyCode.ButtonA, DashPad: Enum.KeyCode.ButtonB }),
							},
						},
					},
				};
				const message = expectThrows(() => InputActions.Create(schema as never, { Folder: folder }));
				expectTrue(message.find("Gameplay/Dash", 1, true)[0] !== undefined, message);
				expectEqual(folder.GetChildren().size(), 0);
			});

			test("a child with a context's name that is not a context throws", () => {
				const folder = newFolder();
				const wrong = new Instance("Folder");
				wrong.Name = "Gameplay";
				wrong.Parent = folder;
				const message = expectThrows(() => InputActions.Create(TEST_SCHEMA, { Folder: folder }));
				expectTrue(message.find("InputContext", 1, true)[0] !== undefined, message);
			});

			test("Create twice adopts the same instances and creates nothing twice", () => {
				const folder = newFolder();
				const first = createTestInput(folder);
				const count = folder.GetDescendants().size();
				const second = createTestInput(folder);
				expectEqual(folder.GetDescendants().size(), count);
				expectEqual(second.Gameplay.Instance, first.Gameplay.Instance);
				expectEqual(
					second.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance,
					first.Gameplay.Actions.Jump.Bindings.KeyboardAndMouse.Instance,
				);
				first.Gameplay.Actions.Dash.Fire(true);
				second.Gameplay.Actions.Dash.Fire(false);
				expectEqual(bindingsOf(first.Gameplay.Actions.Dash.Instance).size(), 1);
			});

			test("Destroy removes what it created and keeps what it adopted", () => {
				const folder = managerFolder();
				const gameplay = child(folder, "Gameplay", "InputContext");
				const jump = child(gameplay, "Jump", "InputAction");
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				input.Gameplay.SetEnabled(true);
				input.Gameplay.Actions.Dash.Fire(true);
				expectDefined(gameplay.FindFirstChild("Look"));
				expectDefined(folder.FindFirstChild("Menu"));

				input.Destroy();
				expectEqual(gameplay.Parent, folder);
				expectEqual(jump.Parent, gameplay);
				expectDefined(jump.FindFirstChild("JumpKeyboardAndMouse"));
				expectDefined(jump.FindFirstChild("InputBinding"));
				expectEqual(gameplay.FindFirstChild("Look"), undefined);
				expectEqual(gameplay.FindFirstChild("Dash"), undefined);
				expectEqual(folder.FindFirstChild("Menu"), undefined);
				expectEqual(folder.FindFirstChild("Ui"), undefined);
				expectEqual(
					child(gameplay, "Move", "InputAction").FindFirstChild("MoveVirtual"),
					undefined,
				);
				// the adopted context keeps the base state it was given
				expectTrue(gameplay.Enabled);
				input.Destroy(); // twice is fine
			});

			test("Destroy releases the actions it held, on instances that stay", () => {
				const folder = managerFolder();
				const input = InputActions.Create(TEST_SCHEMA, { Folder: folder });
				input.Gameplay.SetEnabled(true);
				const jump = input.Gameplay.Actions.Jump.Instance;
				input.Gameplay.Actions.Jump.Fire(true);
				expectTrue(jump.GetState() as boolean);
				input.Destroy();
				expectEqual(jump.Parent, folder.FindFirstChild("Gameplay"));
				expectFalse(jump.GetState() as boolean);
			});

			test("the default folder is ReplicatedStorage.Inputs", () => {
				const existed = ReplicatedStorage.FindFirstChild("Inputs") !== undefined;
				const input = InputActions.Create(
					InputActions.Schema({ DefaultFolderTest: { Actions: { Poke: InputActions.Bool() } } }),
				);
				const folder = expectDefined(ReplicatedStorage.FindFirstChild("Inputs"));
				defer(() => {
					input.Destroy();
					if (!existed) folder.Destroy();
				});
				expectEqual(input.DefaultFolderTest.Instance.Parent, folder);
				input.Destroy();
				expectEqual(folder.FindFirstChild("DefaultFolderTest"), undefined);
			});

			test("PlayerFolderName can't be Roblox's InputContexts", () => {
				expectThrows(() =>
					InputActions.Create(TEST_SCHEMA, {
						Folder: newFolder(),
						PlayerFolderName: "InputContexts",
					}),
				);
			});

			test("contexts can live anywhere: the scratch folder works", () => {
				const input = createTestInput();
				input.Gameplay.Actions.Jump.Fire(true);
				expectTrue(input.Gameplay.Actions.Jump.GetState());
				frame();
			});
		});
	}
}
