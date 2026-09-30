import { GlobalEvents, GlobalFunctions } from "shared/network";
import { throttle, throttleFunction } from "./middleware/throttle";

// Create each handler once, here. The first createServer call wins, and later calls ignore their
// config, middleware included.
export const Events = GlobalEvents.createServer({
	middleware: {
		// Every spawnCoin adds a part to Workspace, so a client must not be able to spam it.
		spawnCoin: [throttle(1)],
	},
});

export const Functions = GlobalFunctions.createServer({
	middleware: {
		getCoins: [throttleFunction(0.5)],
	},
});
