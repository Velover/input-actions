import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectEqual, expectTrue, test } from "@flamework-experimental/testing";

/** Checks the harness itself: the tests load in both realms, and the IAS classes exist. */
@Provider({ activeIn: ["testing"] })
export class SmokeTests implements OnStart {
	onStart() {
		defineTests("smoke", () => {
			test("IAS instances can be created", () => {
				const context = new Instance("InputContext");
				const action = new Instance("InputAction");
				action.Parent = context;
				expectTrue(context.Enabled);
				expectEqual(action.Type, Enum.InputActionType.Bool);
				context.Destroy();
			});
		});
	}
}
