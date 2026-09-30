import { InputActions } from "@rbxts/input-actions";

// Validator round 6: one Server Authority context provided in two steps by the real server, first
// from R6_SMALL, then from R6_LARGE (a second ProvideToPlayers adds the missing action). Shared by
// the server (src/server/tests/validator-r6-server.ts) and the client
// (src/client/tests/validator-r6-sa.ts).

/** The RemoteFunction the client's validator-r6-sa section calls */
export const R6_REMOTE = "ValidatorR6Server";

export const R6_SMALL = InputActions.Schema({
	R6Shared: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.P }),
		},
	},
});

export const R6_LARGE = InputActions.Schema({
	R6Shared: {
		ServerAuthority: true,
		Actions: {
			Poke: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.P }),
			Extra: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.X }, { Enabled: false }),
		},
	},
});
