import { InputActions } from "@rbxts/input-actions";

// Validator round 4: a Server Authority schema whose context and action are declared disabled, shared
// by the server that provides it (src/server/tests/validator-r4-server.ts) and the client that
// enables them (src/client/tests/validator-r4-sa.ts).

/** The RemoteFunction the client's validator-r4-sa section calls */
export const R4_REMOTE = "ValidatorR4Server";
/** The folder under the player that holds R4_SA_SCHEMA's contexts */
export const R4_PLAYER_FOLDER = "ValidatorR4Inputs";

export const R4_SA_SCHEMA = InputActions.Schema({
	/** Starts disabled, as a menu or vehicle context does, and is enabled by the client */
	R4Off: {
		ServerAuthority: true,
		Enabled: false,
		Actions: { Poke: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.P }) },
	},
	R4On: {
		ServerAuthority: true,
		Actions: {
			/** An action declared disabled, enabled by the client */
			Wave: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.O }, { Enabled: false }),
			/** The control: enabled everywhere */
			Nod: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.I }),
		},
	},
	/** The UI preset, marked Server Authority and disabled until a menu opens */
	R4Ui: InputActions.Presets.UiNavigation({ ServerAuthority: true, Enabled: false }),
});
