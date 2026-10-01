import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectTrue, test } from "@flamework-experimental/testing";
import { createTestInput, nearlyEqual } from "./helpers";

const K = Enum.KeyCode;

/** Hunt round 2: the package without real input */
@Provider({ activeIn: ["testing"] })
export class HunterR2ClientTests implements OnStart {
	onStart() {
		defineTests("hunter-r2", () => {
			// docs/API.md, Binding shapes: "Set({ ReleasedThreshold: 0.8 }) on a binding whose
			// PressedThreshold is 0.5 reads (and Get() returns) 0.5 until PressedThreshold is raised."
			// IAS keeps the stored 0.8 (probed). Since this round, Set writes back every property that
			// reads differently, and ReleasedThreshold reads clamped: raising PressedThreshold through
			// Set writes the clamped value over the stored one.
			test("Set: a ReleasedThreshold above PressedThreshold shows once PressedThreshold is raised", () => {
				const pad = createTestInput().Gameplay.Actions.Fire.Bindings.Gamepad;
				// the schema's PressedThreshold is 0.6
				pad.Set({ KeyCode: K.ButtonR2, ReleasedThreshold: 0.8 });
				expectTrue(
					nearlyEqual(pad.Instance.ReleasedThreshold, 0.6),
					`reads ${pad.Instance.ReleasedThreshold} under PressedThreshold 0.6`,
				);
				pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.9 });
				expectTrue(nearlyEqual(pad.Instance.PressedThreshold, 0.9), "PressedThreshold 0.9");
				expectTrue(
					nearlyEqual(pad.Instance.ReleasedThreshold, 0.8),
					`ReleasedThreshold reads ${pad.Instance.ReleasedThreshold} once PressedThreshold is 0.9 (Get: ${pad.Get().ReleasedThreshold})`,
				);
			});

			// The same through the instance directly (the IAS behaviour the docs describe), as a control
			test("control: writing PressedThreshold on the instance shows the stored ReleasedThreshold", () => {
				const pad = createTestInput().Gameplay.Actions.Fire.Bindings.Gamepad;
				pad.Set({ KeyCode: K.ButtonR2, ReleasedThreshold: 0.8 });
				pad.Instance.PressedThreshold = 0.9;
				expectTrue(
					nearlyEqual(pad.Instance.ReleasedThreshold, 0.8),
					`reads ${pad.Instance.ReleasedThreshold}`,
				);
				expectTrue(pad.Instance.KeyCode === K.ButtonR2);
			});
		});
	}
}
