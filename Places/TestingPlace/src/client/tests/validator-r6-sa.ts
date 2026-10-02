import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectEqual,
	expectFalse,
	expectTrue,
	getProject,
	skip,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { R6_LARGE, R6_REMOTE, R6_SMALL } from "shared/fixtures/validator-r6";
import { frames, newFolder } from "./helpers";

// Validator round 6, Server Authority only: the real server provides one context in two steps, so
// one root handle is on the server's copy while another waits on a stand-in, then swaps onto the
// instances the first uses (design spec sections 4 and 8).

function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(R6_REMOTE, 10),
		R6_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

function serverPoke(folderName: string): unknown {
	return server("state", folderName, "R6Shared", "Poke");
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR6ServerAuthorityTests implements OnStart {
	onStart() {
		defineTests("validator-r6-sa", () => {
			test("a press the copy's handle holds stays on the server when a stand-in handle that pressed it too is destroyed after the swap", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const folderName = "ValidatorR6A";
				expectTrue(server("provide", folderName, "small") === true);
				expectDefined(
					Players.LocalPlayer.WaitForChild(folderName, 10)?.WaitForChild("R6Shared", 10),
					"the server's copy",
				);
				const options = { Folder: newFolder(), PlayerFolderName: folderName, Timeout: 1000 };
				const onCopy = InputActions.Create(R6_SMALL, options);
				defer(() => onCopy.Destroy());
				expectTrue(onCopy.R6Shared.IsLinkedToServer(), "the first handle is on the copy");
				const poke = onCopy.R6Shared.Actions.Poke;
				defer(() => poke.Fire(false));
				poke.Fire(true);
				eventually(() => serverPoke(folderName) === true, "the server sees the press");

				const waiting = InputActions.Create(R6_LARGE, options);
				defer(() => waiting.Destroy());
				expectFalse(waiting.R6Shared.IsLinkedToServer(), "the copy lacks Extra: a stand-in");
				waiting.R6Shared.Actions.Poke.Fire(true);
				expectTrue(server("provide", folderName, "large") === true);
				eventually(() => waiting.R6Shared.IsLinkedToServer(), "the swap");

				waiting.Destroy();
				frames(5);
				task.wait(1);
				const onServer = serverPoke(folderName);
				const onClient = poke.IsPressed();
				expectEqual(
					`server ${onServer}, client ${onClient}`,
					"server true, client true",
					"the copy's handle still holds its press",
				);
			});
		});
	}
}
