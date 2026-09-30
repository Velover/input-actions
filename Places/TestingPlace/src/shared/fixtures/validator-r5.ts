import { InputActions } from "@rbxts/input-actions";

// Validator round 5: a Server Authority schema whose template (the Input Action Manager's, built by
// the server in ReplicatedStorage) has its context and one action disabled by the designer. Shared by
// the server that provides it (src/server/tests/validator-r5-server.ts) and the client
// (src/client/tests/validator-r5-sa.ts).

/** The RemoteFunction the client's validator-r5-sa section calls */
export const R5_REMOTE = "ValidatorR5Server";
/** Where the server builds the template, before the client's tests start */
export const R5_TEMPLATE_FOLDER = "ValidatorR5Templates";

export const R5_SA_SCHEMA = InputActions.Schema({
	R5Menu: {
		ServerAuthority: true,
		Actions: {
			Open: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.M }),
			Pick: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.K }),
			Scroll: InputActions.Direction1D({ Virtual: InputActions.Scriptable }),
		},
	},
});

/**
 * The designer's template: R5Menu disabled (a menu, closed until opened), its `Pick` action disabled,
 * `Open` enabled, and an extra action the schema doesn't mention, disabled too.
 */
export function BuildR5Template(parent: Instance): Folder {
	const folder = new Instance("Folder");
	folder.Name = R5_TEMPLATE_FOLDER;
	const context = new Instance("InputContext");
	context.Name = "R5Menu";
	context.Enabled = false;
	context.Priority = 2500;
	const actions: Array<[string, boolean, Enum.KeyCode]> = [
		["Open", true, Enum.KeyCode.M],
		["Pick", false, Enum.KeyCode.K],
		["Hint", false, Enum.KeyCode.H],
	];
	for (const [name, enabled, key] of actions) {
		const action = new Instance("InputAction");
		action.Name = name;
		action.Enabled = enabled;
		const binding = new Instance("InputBinding");
		binding.Name = `${name}KeyboardAndMouse`;
		binding.KeyCode = key;
		binding.Parent = action;
		action.Parent = context;
	}
	const scroll = new Instance("InputAction");
	scroll.Name = "Scroll";
	scroll.Type = Enum.InputActionType.Direction1D;
	scroll.Parent = context;
	context.Parent = folder;
	folder.Parent = parent;
	return folder;
}
