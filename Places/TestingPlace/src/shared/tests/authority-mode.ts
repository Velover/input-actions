import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectFalse,
	expectNoThrow,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { RunService, Workspace } from "@rbxts/services";
import { expectedServerAuthority, names } from "shared/fixtures/authority";
import { skip } from "shared/fixtures/skip";

/** InputActions.IsServerAuthority on both realms, under every project (design spec §8) */
@Provider({ activeIn: ["testing"] })
export class AuthorityModeTests implements OnStart {
	onStart() {
		defineTests("authority-mode", () => {
			test("IsServerAuthority answers the project's mode", () => {
				const expected = expectedServerAuthority();
				if (expected === undefined) {
					return skip(
						`a place flamework-test did not make (project ${getProject()}): no mode to expect`,
					);
				}
				expectEqual(InputActions.IsServerAuthority(), expected);
			});

			test("the answer stays the same, and asking never throws", () => {
				const first = InputActions.IsServerAuthority();
				for (let index = 0; index < 3; index++) {
					expectNoThrow(() => InputActions.IsServerAuthority());
					expectEqual(InputActions.IsServerAuthority(), first);
				}
			});

			// The engine's wording the package reads. Should Roblox reword it, this fails first, and
			// IsServerAuthority answers undefined (the warnings go quiet) until the package learns it
			test("the engine's message is the one the package reads", () => {
				const expected = expectedServerAuthority();
				if (expected === undefined) return skip("no mode to expect in this place");
				const [allowed, reason] = Workspace.Terrain.CanSetNetworkOwnership();
				expectFalse(allowed);
				const message = tostring(reason);
				if (expected) {
					expectEqual(
						message,
						"Can not call Network Ownership API when workspace.AuthorityMode = Enums.AuthorityMode.Server.",
					);
					expectTrue(names(message, "AuthorityMode"), message);
				} else if (RunService.IsServer()) {
					expectEqual(message, "Network Ownership API cannot be used on Terrain");
				} else {
					expectEqual(message, "Network Ownership API can only be called from the Server.");
				}
			});
		});
	}
}
