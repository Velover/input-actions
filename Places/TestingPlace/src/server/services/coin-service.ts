import { OnStart, Provider } from "@flamework-experimental/core";
import { Debris, Players, Workspace } from "@rbxts/services";
import { Events, Functions } from "server/network";
import { Tags } from "shared/tags";

/** Seconds before an uncollected coin disappears, so coins cannot pile up. */
const COIN_LIFETIME = 30;

/** Spawns coins when players ask for them, and keeps each player's coin count. */
@Provider()
export class CoinService implements OnStart {
	private readonly coins = new Map<Player, number>();

	onStart() {
		Events.spawnCoin.connect((player) => this.spawnCoin(player));
		Functions.getCoins.setCallback((player) => this.getCoins(player));
		Players.PlayerRemoving.Connect((player) => this.coins.delete(player));
	}

	getCoins(player: Player) {
		return this.coins.get(player) ?? 0;
	}

	addCoins(player: Player, amount: number) {
		const coins = this.getCoins(player) + amount;
		this.coins.set(player, coins);
		Events.coinsChanged.fire(player, coins);
	}

	private spawnCoin(player: Player) {
		const root = player.Character?.FindFirstChild("HumanoidRootPart");
		if (!root?.IsA("BasePart")) return;

		const coin = new Instance("Part");
		coin.Name = "Coin";
		coin.Shape = Enum.PartType.Cylinder;
		coin.Size = new Vector3(0.4, 2, 2);
		coin.Color = Color3.fromRGB(255, 200, 0);
		coin.Anchored = true;
		coin.CanCollide = false;
		coin.CFrame = root.CFrame.mul(new CFrame(0, 0, -8));
		// The tag is what attaches the Coin component here and CoinSpin on the clients.
		coin.AddTag(Tags.Coin);
		coin.Parent = Workspace;
		Debris.AddItem(coin, COIN_LIFETIME);
	}
}
