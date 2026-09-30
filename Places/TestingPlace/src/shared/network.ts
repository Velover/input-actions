import { Networking } from "@flamework-experimental/networking";

// Each interface is named for the direction its messages travel.

interface ClientToServerEvents {
	/** Asks the server to spawn a coin in front of the player's character. */
	spawnCoin(): void;
}

interface ServerToClientEvents {
	/** The player's coin count changed. */
	coinsChanged(coins: number): void;
}

interface ClientToServerFunctions {
	/** The player's current coin count. */
	getCoins(): number;
}

// The first type argument is what the server receives, the second what the client receives.
export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();
export const GlobalFunctions = Networking.createFunction<ClientToServerFunctions, {}>();
