// Server Authority (Workspace.AuthorityMode = Server): the server provides the contexts and reads
// the state; the client adds its own bindings.
import { InputActions } from "@rbxts/input-actions";
import { Players, RunService } from "@rbxts/services";

// shared: the same schema on both realms
export const InputSchema = InputActions.Schema({
	Character: {
		ServerAuthority: true, // the server needs this state
		Priority: 2000,
		Sink: true,
		Actions: {
			Move: InputActions.Direction2D({
				KeyboardAndMouse: {
					Up: Enum.KeyCode.W,
					Down: Enum.KeyCode.S,
					Left: Enum.KeyCode.A,
					Right: Enum.KeyCode.D,
				},
				Gamepad: Enum.KeyCode.Thumbstick1,
			}),
			Dash: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Q, Gamepad: Enum.KeyCode.ButtonX }),
		},
	},
	Menu: {
		// client only: never sent to the server
		Actions: { Open: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.M }) },
	},
});

// server
export function StartServer() {
	// Warns when the place doesn't run Server Authority: InputActions.IsServerAuthority() is false
	InputActions.ProvideToPlayers(InputSchema);

	const handles = new Map<Player, InputActions.ServerHandle<typeof InputSchema.Contexts>>();
	Players.PlayerAdded.Connect((player) => {
		const input = InputActions.ForPlayer(InputSchema, player); // waits for the player's copy
		handles.set(player, input);
		input.Character.Actions.Dash.Pressed.Connect(() => print(`${player.Name} dashed`));
	});
	Players.PlayerRemoving.Connect((player) => handles.delete(player));

	// The state is predicted and replayed: read it in the simulation step
	RunService.BindToSimulation(() => {
		for (const [player, input] of handles) {
			const move = input.Character.Actions.Move.GetState(); // Vector2
			if (move.Magnitude > 0) print(`${player.Name} moves ${move}`);
		}
	});
}

// client: the same Create. It never waits: until the server's copy arrives under
// LocalPlayer.Inputs, the context runs on a local stand-in, then the handles swap to the copy.
export function StartClient() {
	const Input = InputActions.Create(InputSchema, { Timeout: 15 }); // warns after 15 s without the copy
	// called at once if the copy is there already, else when it arrives (LinkedToServer fires only then)
	Input.Character.WhenLinkedToServer((copy) =>
		print(`the server now receives ${copy.Name}'s state`),
	);
	Input.Character.Actions.Dash.Bindings.KeyboardAndMouse.Set(Enum.KeyCode.E); // keybinds stay local
	Input.Menu.Actions.Open.Pressed.Connect(() => print("menu"));
}
