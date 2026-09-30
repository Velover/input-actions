import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectDefined, test } from "@flamework-experimental/testing";
import { Players } from "@rbxts/services";

/** Checks the client realm runs its own sections. */
@Provider({ activeIn: ["testing"] })
export class ClientSmokeTests implements OnStart {
	onStart() {
		defineTests("client-smoke", () => {
			test("the client has a local player", () => {
				expectDefined(Players.LocalPlayer);
			});
		});
	}
}
