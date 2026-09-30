import { BaseComponent, Component } from "@flamework-experimental/components";
import { OnTick } from "@flamework-experimental/core";
import { Tags } from "shared/tags";

const DEGREES_PER_SECOND = 90;

/**
 * Spins coins on this client. It shares its tag with the server's `Coin`: each realm registers its
 * own class for the same instances.
 */
@Component({ tag: Tags.Coin })
export class CoinSpin extends BaseComponent<{}, BasePart> implements OnTick {
	onTick(dt: number) {
		this.instance.CFrame = this.instance.CFrame.mul(
			CFrame.Angles(0, math.rad(DEGREES_PER_SECOND * dt), 0),
		);
	}
}
