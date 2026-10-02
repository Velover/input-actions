import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectEqual,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { expectedSignalBehavior } from "shared/fixtures/projects";
import { countSignal, createTestInput, newFolder } from "./helpers";

/** The client's half of `signal-behavior` (src/shared/tests/signal-behavior.ts): IAS and the handles */
@Provider({ activeIn: ["testing"] })
export class ClientSignalBehaviorTests implements OnStart {
	onStart() {
		defineTests("signal-behavior", () => {
			test("IAS's Pressed follows it: inside a Scriptable binding's Fire only under Immediate", () => {
				const expected = expectedSignalBehavior();
				if (expected === undefined) {
					return skip(`a place flamework-test did not make (project ${getProject()})`);
				}
				const context = new Instance("InputContext");
				const action = new Instance("InputAction");
				action.Parent = context;
				const binding = new Instance("InputBinding");
				binding.Type = Enum.InputBindingType.Scriptable;
				binding.Parent = action;
				context.Parent = newFolder();
				defer(() => context.Destroy());
				const pressed = countSignal(action.Pressed);
				binding.Fire(true);
				expectEqual(
					pressed.count === 1 ? "Immediate" : "Deferred",
					expected,
					"IAS's Pressed had fired when Fire returned",
				);
				eventually(() => pressed.count === 1, "Pressed");
				binding.Fire(false);
			});

			test("a handle's Pressed and Released follow it, once each", () => {
				const expected = expectedSignalBehavior();
				if (expected === undefined) {
					return skip(`a place flamework-test did not make (project ${getProject()})`);
				}
				const jump = createTestInput().Gameplay.Actions.Jump;
				const pressed = countSignal(jump.Pressed);
				const released = countSignal(jump.Released);
				jump.Fire(true);
				expectEqual(
					pressed.count === 1 ? "Immediate" : "Deferred",
					expected,
					"the handle's Pressed had fired when Fire returned",
				);
				eventually(() => pressed.count === 1, "Pressed");
				jump.Fire(false);
				expectEqual(
					released.count === 1 ? "Immediate" : "Deferred",
					expected,
					"the handle's Released had fired when Fire returned",
				);
				eventually(() => released.count === 1, "Released");
				expectEqual(pressed.count, 1, "one Pressed");
			});
		});
	}
}
