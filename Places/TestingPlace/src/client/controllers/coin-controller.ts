import { OnStart, Provider } from "@flamework-experimental/core";
import { UserInputService } from "@rbxts/services";
import { Events, Functions } from "client/network";
import { getLevel } from "shared/levels";

/** Press F to spawn a coin in front of you. Prints your coins and level whenever they change. */
@Provider()
export class CoinController implements OnStart {
	onStart() {
		Events.coinsChanged.connect((coins) => this.show(coins));

		Functions.getCoins
			.invoke()
			.then((coins) => this.show(coins))
			.catch((reason) => warn("Could not get the coin count:", reason));

		UserInputService.InputBegan.Connect((input, processed) => {
			if (!processed && input.KeyCode === Enum.KeyCode.F) Events.spawnCoin.fire();
		});
	}

	private show(coins: number) {
		print(`Coins: ${coins}, level ${getLevel(coins)}`);
	}
}
