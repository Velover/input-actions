import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import {
	GuiService,
	Players,
	ReplicatedStorage,
	RunService,
	UserInputService,
} from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { skip } from "shared/fixtures/skip";
import { countSignal, createTestInput, frames } from "./helpers";
import { clickProblem, emptyPoint, realInput, screenCenter, testButton, testGui } from "./virtual";

const K = Enum.KeyCode;

const MOUSE_AS_TOUCH =
	"Studio simulates a phone: mouse events arrive as touch (the touch section taps instead)";

function isTouch() {
	return getProject() === "touch";
}

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

/** The Pressed/Released sequence of a Bool action until the test ends, as "P" and "R" */
function recordPresses(action: InputActions.BoolAction) {
	const events = new Array<string>();
	const pressed = action.Pressed.Connect(() => events.push("P"));
	const released = action.Released.Connect(() => events.push("R"));
	defer(() => {
		pressed.Disconnect();
		released.Disconnect();
	});
	return events;
}

/** Calls `read` every frame until the test ends, and records what it returns when it isn't `rest` */
function watch<T extends defined>(read: () => T, rest: T): T[] {
	const seen = new Array<T>();
	const connection = RunService.Heartbeat.Connect(() => {
		const value = read();
		if (value !== rest) seen.push(value);
	});
	defer(() => connection.Disconnect());
	return seen;
}

/**
 * Hunt round 3: the package with real input (VirtualInput), in every project; and the tap path of
 * Capture on the simulated phone
 */
@Provider({ activeIn: ["testing"] })
export class HunterR3RealTests implements OnStart {
	onStart() {
		defineTests("hunter-r3-real", () => {
			// docs/Advanced.md, Rebinding: "Mouse buttons and touch count as MouseLeftButton/.../TouchPosition"
			test("touch: Capture takes a tap on the world as TouchPosition; a finger down then presses the action", () => {
				if (!isTouch()) return;
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const jump = createTestInput().Gameplay.Actions.Jump;
				const keys = jump.Bindings.KeyboardAndMouse;
				const captured = new Array<Enum.KeyCode>();
				keys.Capture("KeyCode", (key) => captured.push(key));
				real.Click(emptyPoint());
				eventually(() => captured.size() === 1, "the tap captured");
				expectEqual(captured[0], K.TouchPosition);
				expectEqual(keys.Instance.KeyCode, K.TouchPosition);
				frames(3);
				real.MouseDown(emptyPoint());
				eventually(() => jump.IsPressed(), "a finger down presses Jump");
				real.MouseUp();
				eventually(() => !jump.IsPressed(), "released with the finger");
			});

			test("RawInputHandler.MouseInputSetEnabled(false): a real wheel notch doesn't zoom; enabled again, it does", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				RawInputHandler.Initialize();
				RawInputHandler.MouseInputSetEnabled(false);
				defer(() => RawInputHandler.MouseInputSetEnabled(true));
				frames(2);
				const zooms = watch(() => RawInputHandler.GetZoomDelta(), 0);
				real.Wheel(1);
				frames(10);
				expectEqual(zooms.size(), 0, `zooms while mouse input is off: ${zooms.join(", ")}`);
				RawInputHandler.MouseInputSetEnabled(true);
				frames(2);
				// back the other way: under the legacy player scripts every notch zooms the camera too,
				// and four notches in put it in first person, which locks the cursor at the centre
				real.Wheel(-1);
				eventually(() => zooms.size() > 0, "a zoom once mouse input is on");
			});

			test("one button attached to two actions: a click presses both; detaching one while held releases only it", () => {
				if (isTouch()) return skip(MOUSE_AS_TOUCH);
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				const { Jump, Dash } = createTestInput().Gameplay.Actions;
				const button = testButton(testGui());
				const problem = clickProblem(button);
				if (problem !== undefined) return skip(problem);
				const dashReleased = countSignal(Dash.Released);
				Jump.AttachButton(button);
				const detachDash = Dash.AttachButton(button);
				const activated = countSignal(button.Activated);
				const at = screenCenter(button);
				real.MouseDown(at);
				const describe = () => {
					const [inset] = GuiService.GetGuiInset();
					const objects = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui")!
						.GetGuiObjectsAtPosition(at.X - inset.X, at.Y - inset.Y)
						.map((gui) => gui.GetFullName());
					return `Jump ${Jump.IsPressed()}, Dash ${Dash.IsPressed()}; MouseBehavior ${UserInputService.MouseBehavior.Name}; selected ${GuiService.SelectedObject?.GetFullName()}; focused ${UserInputService.GetFocusedTextBox()?.GetFullName()}; menu ${GuiService.MenuIsOpen}; at ${at}: ${objects.join(", ")}`;
				};
				const settled = os.clock() + 5;
				while (!(Jump.IsPressed() && Dash.IsPressed()) && os.clock() < settled) frames(1);
				expectTrue(Jump.IsPressed() && Dash.IsPressed(), `both pressed: ${describe()}`);
				detachDash();
				eventually(() => !Dash.IsPressed(), "Dash released with its binding");
				frames(3);
				expectTrue(Jump.IsPressed(), "Jump still held");
				real.MouseUp();
				eventually(() => !Jump.IsPressed(), "Jump released with the button");
				expectEqual(dashReleased.count, 1);
				eventually(() => activated.count === 1, "Activated");
			});

			// A context marked ServerAuthority: true in a place without Server Authority still works on
			// the client (design spec §8). Its copy under the player is a local context there: IAS
			// releases a held action when its keys change, and the package's release pair for the
			// server, fired after the change, presses and releases it once more (probed table: "On a
			// local context the same pair after the change adds a second Pressed/Released")
			test("a provided copy in a place without Server Authority: a rebind while a real key holds Jump releases it once, and presses nothing", () => {
				if (getProject() === "authority") return;
				const real = realInput();
				if (typeIs(real, "string")) return skip(real);
				expectTrue(server("provide", "sa") === true);
				const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
				defer(() => input.Destroy());
				eventually(() => input.SaGameplay.IsLinkedToServer(), "on the server's copy");
				expectEqual(InputActions.IsServerAuthority(), false);
				const jump = input.SaGameplay.Actions.Jump;
				const events = recordPresses(jump);
				// the template binds Jump's KeyboardAndMouse to F
				real.Press(K.F);
				eventually(() => events.size() === 1, "F presses Jump");
				jump.Bindings.Gamepad.Set(K.ButtonB);
				frames(10);
				expectEqual(events.join(""), "PR", "Pressed/Released, the rebind 10 frames ago");
				expectFalse(jump.IsPressed(), "released");
				real.Release(K.F);
				frames(5);
				expectEqual(events.join(""), "PR", "after F came up");
			});
		});
	}
}
