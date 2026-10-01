import { InputActions } from "@rbxts/input-actions";

/** The RemoteFunction the server's hunter-r2 fixture hosts (src/server/tests/hunter-r2-server.ts) */
export const HUNTER_R2_REMOTE = "InputActionsHunterR2Server";

/**
 * A Server Authority schema the server provides only when a client test asks, under a player
 * folder name of the test's own: the client's `Create` starts on stand-ins, and the real server's
 * copy arrives while the test holds keys
 */
export const HUNTER_LATE_SCHEMA = InputActions.Schema({
	HunterLate: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.J }),
			Crouch: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.K }, { TrackPrevious: true }),
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.T,
					Down: Enum.KeyCode.Y,
					Left: Enum.KeyCode.U,
					Right: Enum.KeyCode.N,
				},
			}),
		},
	},
});
