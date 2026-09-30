import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, eventually, scratch, test } from "@flamework-experimental/testing";
import { Tags } from "shared/tags";

/** A client test: a part made here exists on this client only, and gets the client's component. */
@Provider({ activeIn: ["testing"] })
export class CoinSpinTests implements OnStart {
	onStart() {
		defineTests("coin-spin", () => {
			test("a coin turns every frame", () => {
				const part = new Instance("Part");
				part.Anchored = true;
				part.AddTag(Tags.Coin);
				part.Parent = scratch();
				const facing = part.CFrame.LookVector;

				// OnTick runs on the next frames, so wait for it rather than check at once.
				eventually(() => part.CFrame.LookVector.Dot(facing) < 0.99, "the coin to turn");
			});
		});
	}
}
