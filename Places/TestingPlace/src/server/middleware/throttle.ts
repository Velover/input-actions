import { Networking } from "@flamework-experimental/networking";
import { Players } from "@rbxts/services";

/** Whether a player's message may pass: false when it comes less than `seconds` after the last. */
function createLimiter(seconds: number) {
	const lastAccepted = new Map<Player, number>();
	Players.PlayerRemoving.Connect((player) => lastAccepted.delete(player));

	return (player: Player) => {
		const now = os.clock();
		const last = lastAccepted.get(player);
		if (last !== undefined && now - last < seconds) return false;

		lastAccepted.set(player, now);
		return true;
	};
}

// The type allows a missing player because clients share it; on the server there is always one.

/** Drops a player's event when it comes less than `seconds` after their last accepted one. */
export function throttle<T extends unknown[]>(seconds: number): Networking.EventMiddleware<T> {
	return (processNext) => {
		const accept = createLimiter(seconds);
		return (player, ...args) => {
			if (player === undefined || accept(player)) return processNext(player, ...args);
		};
	};
}

/**
 * The same for a function. A dropped call returns `Networking.Skip`, so the caller's Promise
 * rejects with `Cancelled` at once.
 */
export function throttleFunction<T extends unknown[], O>(
	seconds: number,
): Networking.FunctionMiddleware<T, O> {
	return (processNext) => {
		const accept = createLimiter(seconds);
		return (player, ...args) => {
			if (player === undefined || accept(player)) return processNext(player, ...args);
			return Networking.Skip;
		};
	};
}
