import { eventually } from "@flamework-experimental/testing";
import { Players } from "@rbxts/services";

/** The play session's player. A test that sends to a player needs a real one. */
export function waitForPlayer() {
	eventually(() => Players.GetPlayers().size() > 0, "a player to join");
	return Players.GetPlayers()[0];
}

/** The player's character's root part, once the character has spawned. */
export function waitForRoot(player: Player) {
	eventually(
		() => player.Character?.FindFirstChild("HumanoidRootPart") !== undefined,
		"a character",
	);
	return player.Character!.FindFirstChild("HumanoidRootPart") as BasePart;
}
