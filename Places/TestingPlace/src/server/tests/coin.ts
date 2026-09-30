import { Components } from "@flamework-experimental/components";
import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	scratch,
	test,
} from "@flamework-experimental/testing";
import { Coin } from "server/components/coin";
import { CoinService } from "server/services/coin-service";
import { Tags } from "shared/tags";
import { waitForPlayer, waitForRoot } from "./players";

/** A tagged part in the test's scratch folder, which is destroyed after the test. */
function makeCoin(cframe = new CFrame(0, 100, 0), size = new Vector3(2, 2, 2)) {
	const part = new Instance("Part");
	part.Anchored = true;
	part.CanCollide = false;
	part.CFrame = cframe;
	part.Size = size;
	part.AddTag(Tags.Coin);
	part.Parent = scratch();
	return part;
}

/** A component under test: tag a part, then reach the component through `Components`. */
@Provider({ activeIn: ["testing"] })
export class CoinTests implements OnStart {
	constructor(
		private readonly components: Components,
		private readonly coinService: CoinService,
	) {}

	onStart() {
		defineTests("coin", () => {
			test("a coin without a Value is worth 1", () => {
				const part = makeCoin();
				const coin = expectDefined(this.components.getComponent<Coin>(part));

				expectEqual(coin.attributes.Value, 1);
				expectEqual(part.GetAttribute("Value"), 1, "the default written to the part");
			});

			test("collect pays once and removes the coin", () => {
				const player = waitForPlayer();
				const part = makeCoin();
				part.SetAttribute("Value", 5);
				const coin = expectDefined(this.components.getComponent<Coin>(part));
				const before = this.coinService.getCoins(player);

				coin.collect(player);
				coin.collect(player);
				expectEqual(this.coinService.getCoins(player), before + 5);
				expectEqual(part.Parent, undefined);
			});

			test("touches that arrive together pay once", () => {
				const player = waitForPlayer();
				const root = waitForRoot(player);
				const before = this.coinService.getCoins(player);

				// Big enough to overlap most of the character, so its parts touch the coin in one
				// step. With deferred signals, their Touched handlers are then all pending at once.
				const part = makeCoin(root.CFrame, new Vector3(8, 8, 8));

				eventually(() => part.Parent === undefined, "the character to collect the coin");
				expectEqual(this.coinService.getCoins(player), before + 1);
			});
		});
	}
}
