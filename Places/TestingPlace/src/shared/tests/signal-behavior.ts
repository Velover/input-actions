import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectEqual,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { expectedSignalBehavior } from "shared/fixtures/projects";

/**
 * Whether the place runs the `SignalBehavior` its project sets, on both realms. No script can read
 * the property, so it is told by a BindableEvent: under Immediate its handler runs inside `Fire`,
 * under Deferred after it. The client's half (IAS and the package's handles) is in
 * src/client/tests/signal-behavior.ts.
 */
@Provider({ activeIn: ["testing"] })
export class SignalBehaviorTests implements OnStart {
	onStart() {
		defineTests("signal-behavior", () => {
			test("the place runs the project's SignalBehavior", () => {
				const expected = expectedSignalBehavior();
				if (expected === undefined) {
					return skip(`a place flamework-test did not make (project ${getProject()})`);
				}
				const event = new Instance("BindableEvent");
				defer(() => event.Destroy());
				let ran = false;
				event.Event.Connect(() => (ran = true));
				event.Fire();
				expectEqual(
					ran ? "Immediate" : "Deferred",
					expected,
					"a BindableEvent's handler ran inside Fire",
				);
			});
		});
	}
}
