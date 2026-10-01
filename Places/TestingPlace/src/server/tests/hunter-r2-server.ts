import { OnStart, Provider } from "@flamework-experimental/core";
import { InputActions } from "@rbxts/input-actions";
import { ReplicatedStorage } from "@rbxts/services";
import { HUNTER_LATE_SCHEMA, HUNTER_R2_REMOTE } from "shared/fixtures/hunter-r2-fixture";

type AnyServerHandle = Record<string, { Actions: Record<string, { GetState(): unknown }> }>;

/**
 * Hunt round 2: the server side of the client's hunter-r2-sa swap tests. `("provide", folder)`
 * provides HUNTER_LATE_SCHEMA under that player folder name; `("state", folder, action)` reads the
 * server's state of a HunterLate action; `("stop", folder)` stops providing and removes the folder.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR2ServerFixture implements OnStart {
	onStart() {
		const stops = new Map<string, () => void>();
		const remote = new Instance("RemoteFunction");
		remote.Name = HUNTER_R2_REMOTE;
		remote.OnServerInvoke = (player, command, folder, actionName) => {
			const folderName = folder as string;
			if (command === "provide") {
				if (!stops.has(folderName)) {
					stops.set(
						folderName,
						InputActions.ProvideToPlayers(HUNTER_LATE_SCHEMA, { PlayerFolderName: folderName }),
					);
				}
				return true;
			}
			if (command === "stop") {
				stops.get(folderName)?.();
				stops.delete(folderName);
				player.FindFirstChild(folderName)?.Destroy();
				return true;
			}
			if (command === "state") {
				const handle = InputActions.ForPlayer(HUNTER_LATE_SCHEMA, player, {
					PlayerFolderName: folderName,
				}) as unknown as AnyServerHandle;
				return handle.HunterLate.Actions[actionName as string].GetState();
			}
			return undefined;
		};
		remote.Parent = ReplicatedStorage;
	}
}
