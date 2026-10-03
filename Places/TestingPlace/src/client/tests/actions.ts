import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	eventually,
	expectArrayEqual,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { countSignal, createTestInput, frame, frames, recordSignal } from "./helpers";

/** Action handles at runtime, driven through Scriptable bindings (design spec §6) */
@Provider({ activeIn: ["testing"] })
export class ActionTests implements OnStart {
	onStart() {
		defineTests("actions", () => {
			test("Bool: Fire sets the state at once; Pressed and Released follow", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				const changes = recordSignal(jump.StateChanged);

				jump.Fire(true);
				expectTrue(jump.GetState());
				expectTrue(jump.IsPressed());
				eventually(() => pressed.count === 1, "Pressed");
				jump.Fire(true); // the same value again does nothing
				frame();
				expectEqual(pressed.count, 1);

				jump.Fire(false);
				expectFalse(jump.GetState());
				expectFalse(jump.IsPressed());
				eventually(() => released.count === 1, "Released");
				expectArrayEqual(changes, [true, false]);
			});

			test("Direction1D carries a number; Fire applies no Scale", () => {
				const zoom = createTestInput().Gameplay.Actions.Zoom;
				zoom.Fire(0.1);
				// IAS applies no Scale (nor clamp or Vector2Scale) to fired values (probed)
				(zoom.Instance.FindFirstChild("ZoomScript") as InputBinding).Scale = 3;
				zoom.Fire(0.5);
				expectEqual(zoom.GetState(), 0.5);
				zoom.Fire(-2.5);
				expectEqual(zoom.GetState(), -2.5);
				// the handle's signal forwards the IAS one, so it may still deliver the values fired above
				const changes = recordSignal(zoom.StateChanged);
				zoom.Fire(0);
				eventually(() => changes.size() > 0 && changes[changes.size() - 1] === 0, "StateChanged 0");
			});

			test("Direction2D carries a Vector2", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				move.Fire(new Vector2(0.3, -0.4));
				expectEqual(move.GetState(), new Vector2(0.3, -0.4));
				move.Fire(Vector2.zero);
				expectEqual(move.GetState(), Vector2.zero);
			});

			test("Direction3D carries a Vector3, unclamped", () => {
				const fly = createTestInput().Gameplay.Actions.Fly;
				fly.Fire(new Vector3(1, 2, 3));
				expectEqual(fly.GetState(), new Vector3(1, 2, 3));
			});

			test("ViewportPosition carries a Vector2 in pixels", () => {
				const aim = createTestInput().Gameplay.Actions.Aim;
				aim.Fire(new Vector2(120, 340));
				expectEqual(aim.GetState(), new Vector2(120, 340));
			});

			test("a Scriptable binding handle fires its own binding", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				const virtual = move.Bindings.Virtual;
				expectEqual(virtual.Instance.Type, Enum.InputBindingType.Scriptable);
				virtual.Fire(new Vector2(0, 1));
				expectEqual(move.GetState(), new Vector2(0, 1));
			});

			test("several bindings are not combined: the last one to change wins", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				move.Bindings.Virtual.Fire(new Vector2(1, 0));
				move.Fire(new Vector2(0, 1));
				expectEqual(move.GetState(), new Vector2(0, 1));
				move.Fire(Vector2.zero);
				expectEqual(move.GetState(), Vector2.zero);
			});

			test("Fire creates one <Action>Script binding on first use", () => {
				const dash = createTestInput().Gameplay.Actions.Dash;
				// the three device bindings every action has, unbound here
				expectEqual(dash.Instance.GetChildren().size(), 3);
				dash.Fire(true);
				dash.Fire(false);
				dash.Fire(true);
				const children = dash.Instance.GetChildren().filter((child) => child.Name === "DashScript");
				expectEqual(children.size(), 1);
				expectEqual(dash.Instance.GetChildren().size(), 4);
				expectEqual((children[0] as InputBinding).Type, Enum.InputBindingType.Scriptable);
			});

			test("Fire with a value of another type throws", () => {
				const input = createTestInput();
				const untyped = (action: object) => action as { Fire(value: unknown): void };
				const message = expectThrows(() => untyped(input.Gameplay.Actions.Jump).Fire(0.5));
				expectTrue(message.find("bool", 1, true)[0] !== undefined, message);
				expectThrows(() => untyped(input.Gameplay.Actions.Move).Fire(true));
				expectNoThrow(() => untyped(input.Gameplay.Actions.Move).Fire(Vector2.zero));
			});

			test("Tap fires true, then false on the next frame", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				jump.Tap();
				expectTrue(jump.GetState());
				eventually(() => !jump.GetState(), "the release");
				eventually(() => pressed.count === 1 && released.count === 1, "Pressed and Released");
			});

			test("SetEnabled passes through to the InputAction; a disabled action ignores Fire", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				expectTrue(jump.IsEnabled());
				jump.SetEnabled(false);
				expectFalse(jump.Instance.Enabled);
				expectFalse(jump.IsEnabled());
				jump.Fire(true);
				jump.SetEnabled(true);
				expectFalse(jump.GetState());
			});

			test("disabling a held action resets it", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				jump.Fire(true);
				frames(2);
				jump.SetEnabled(false);
				jump.SetEnabled(true);
				expectFalse(jump.GetState());
			});

			test("a fired value persists", () => {
				const move = createTestInput().Gameplay.Actions.Move;
				move.Fire(new Vector2(0.5, 0.5));
				frames(10);
				expectEqual(move.GetState(), new Vector2(0.5, 0.5));
			});

			test("GetPreferredBinding is the action's PreferredBinding", () => {
				const jump = createTestInput().Gameplay.Actions.Jump;
				frame();
				expectEqual(jump.GetPreferredBinding(), jump.Instance.PreferredBinding);
			});
		});
	}
}
