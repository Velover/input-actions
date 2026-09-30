import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectEqual, test } from "@flamework-experimental/testing";
import { getLevel } from "shared/levels";

/** Pure logic: nothing to build or wait for. Both realms register shared/tests, so both run it. */
@Provider({ activeIn: ["testing"] })
export class LevelTests implements OnStart {
	onStart() {
		defineTests("levels", () => {
			test("each level starts at its threshold", () => {
				expectEqual(getLevel(0), 1);
				expectEqual(getLevel(9), 1);
				expectEqual(getLevel(10), 2);
				expectEqual(getLevel(29), 2);
				expectEqual(getLevel(30), 3);
				expectEqual(getLevel(60), 4);
			});

			test("just below a threshold is the level before", () => {
				expectEqual(getLevel(29.999999999999996), 2);
				expectEqual(getLevel(59.99999999999999), 3);
			});

			test("values a coin count should never hold still return", () => {
				expectEqual(getLevel(-5), 1);
				expectEqual(getLevel(0 / 0), 1);
				expectEqual(getLevel(math.huge), math.huge);
			});
		});
	}
}
