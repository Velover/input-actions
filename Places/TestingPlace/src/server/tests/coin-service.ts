import { OnStart, Provider } from "@flamework-experimental/core";
import { NetworkingFunctionError } from "@flamework-experimental/networking";
import {
	defineTests,
	expectEqual,
	expectRejects,
	expectResolves,
	scratch,
	test,
} from "@flamework-experimental/testing";
import { Functions } from "server/network";
import { CoinService } from "server/services/coin-service";
import { waitForPlayer } from "./players";

/** A provider under test, injected like anywhere else. */
@Provider({ activeIn: ["testing"] })
export class CoinServiceTests implements OnStart {
	constructor(private readonly coinService: CoinService) {}

	onStart() {
		defineTests("coin-service", () => {
			test("addCoins adds to the player's count", () => {
				// Other tests pay this player too, so compare with the count before. Two calls: a
				// count that was set rather than added would end at 4, never at before + 7.
				const player = waitForPlayer();
				const before = this.coinService.getCoins(player);

				this.coinService.addCoins(player, 3);
				this.coinService.addCoins(player, 4);
				expectEqual(this.coinService.getCoins(player), before + 7);
			});

			test("getCoins answers through its middleware", () => {
				// predict runs the server's side of the call here, middleware included. The player is
				// a stand-in: nothing is sent to it, and the throttle has never seen it.
				const player = scratch() as unknown as Player;

				expectEqual(expectResolves(Functions.getCoins.predict(player)), 0);
				// throttleFunction refuses a second call within half a second.
				expectEqual(
					expectRejects(Functions.getCoins.predict(player)),
					NetworkingFunctionError.Cancelled,
				);
			});
		});
	}
}
