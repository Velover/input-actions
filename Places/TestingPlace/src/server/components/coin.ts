import { BaseComponent, Component, ComponentMetadata } from "@flamework-experimental/components";
import { OnStart } from "@flamework-experimental/core";
import { Players } from "@rbxts/services";
import { CoinService } from "server/services/coin-service";
import { Tags } from "shared/tags";

interface Attributes {
	/** How many coins touching this one gives. */
	Value: number;
}

/** A coin that gives its `Value` to the first player who touches it, then disappears. */
@Component({
	tag: Tags.Coin,
	// Written to the instance when the attribute is missing or not a number.
	defaults: { Value: 1 },
})
export class Coin extends BaseComponent<Attributes, BasePart> implements OnStart {
	private touched?: RBXScriptConnection;
	private collected = false;

	constructor(
		metadata: ComponentMetadata,
		private readonly coinService: CoinService,
	) {
		super(metadata);
	}

	onStart() {
		this.touched = this.instance.Touched.Connect((hit) => {
			const player = Players.GetPlayerFromCharacter(hit.Parent);
			if (player) this.collect(player);
		});
	}

	collect(player: Player) {
		// With deferred signals, several touches can be pending at once, and destroying the part
		// still runs them. Only the first one pays.
		if (this.collected) return;
		this.collected = true;

		this.coinService.addCoins(player, this.attributes.Value);
		// Destroying the part removes its tag, which removes this component.
		this.instance.Destroy();
	}

	override destroy() {
		// Removing the tag alone removes the component but keeps the part, so disconnect here.
		this.touched?.Disconnect();
		super.destroy();
	}
}
