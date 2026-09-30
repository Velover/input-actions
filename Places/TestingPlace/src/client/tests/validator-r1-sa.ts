import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	eventually,
	expectDefined,
	expectTrue,
	getProject,
	test,
} from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { Players, ReplicatedStorage } from "@rbxts/services";
import { SA_REMOTE, SA_SCHEMA } from "shared/fixtures/schemas";
import { frames } from "./helpers";

// Validator round 1: Server Authority end to end, what reaches the server when the client releases.

/** Calls the server's fixture (src/server/tests/server-authority.ts) */
function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(SA_REMOTE, 10),
		SA_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

function createSaInput() {
	expectTrue(server("provide", "sa") === true);
	const input = InputActions.Create(SA_SCHEMA, { Folder: server("templates") as Folder });
	defer(() => input.Destroy());
	return input;
}

function serverJump() {
	return server("state", "sa", "SaGameplay", "Jump");
}

function serverMove() {
	return server("state", "sa", "SaGameplay", "Move");
}

/** A Scriptable binding the user made under the action (stands in for a held hardware key) */
function userHolder(action: InputAction) {
	const holder = new Instance("InputBinding");
	holder.Name = "ValidatorR1Holder";
	holder.Type = Enum.InputBindingType.Scriptable;
	holder.Parent = action;
	defer(() => {
		// a real true/false change, so the server lets go even when the client already sits at rest
		pcall(() => holder.Fire(true));
		frames(3);
		pcall(() => holder.Fire(false));
		pcall(() => eventually(() => serverJump() === false, "the holder released", 5));
		holder.Destroy();
	});
	return holder;
}

/** Leaves the server's Jump released, whatever the test left behind (other sections read it) */
function unstickJump(jump: { SetEnabled(enabled: boolean): void; Fire(value: boolean): void }) {
	defer(() => {
		jump.SetEnabled(true);
		jump.Fire(true);
		frames(3);
		jump.Fire(false);
		pcall(() => eventually(() => serverJump() === false, "Jump released", 5));
	});
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR1ServerAuthorityTests implements OnStart {
	onStart() {
		defineTests("validator-r1-sa", () => {
			test("a context Request(false) releases a user-held binding on the server too", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				const holder = userHolder(jump.Instance);
				holder.Fire(true);
				eventually(() => serverJump() === true, "the server to see Jump held", 10);
				const release = input.SaGameplay.Request(false);
				defer(release);
				eventually(() => !jump.IsPressed(), "the release on the client");
				eventually(() => serverJump() === false, "the release on the server", 5);
			});

			test("action SetEnabled(false) releases a Fire-held action on the server", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				unstickJump(jump);
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server to see Jump held", 10);
				jump.SetEnabled(false);
				eventually(() => serverJump() === false, "the release on the server", 5);
			});

			test("after SetEnabled(false/true), Fire(true) reaches the server again", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				unstickJump(jump);
				jump.Fire(true);
				eventually(() => serverJump() === true, "the server to see Jump held", 10);
				jump.SetEnabled(false);
				frames(3);
				jump.SetEnabled(true);
				eventually(() => serverJump() === false, "the release on the server", 5);
				jump.Fire(true);
				eventually(() => jump.IsPressed(), "the press again on the client", 2);
				eventually(() => serverJump() === true, "the press again on the server", 5);
				jump.Fire(false);
			});

			test("Tap reaches the server as a press", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const jump = input.SaGameplay.Actions.Jump;
				unstickJump(jump);
				eventually(() => serverJump() === false, "Jump at rest on the server", 5);
				const before = server("pressed", "sa") as number;
				jump.Tap();
				eventually(
					() => (server("pressed", "sa") as number) > before,
					"the server's Pressed for a Tap",
					5,
				);
			});

			test("the focus-loss reset releases the server's state, and input works after it", () => {
				if (getProject() !== "authority") return;
				const input = createSaInput();
				const move = input.SaGameplay.Actions.Move;
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				eventually(() => serverMove() === new Vector2(0, 1), "the server to see Move", 10);

				const gui = new Instance("ScreenGui");
				gui.ResetOnSpawn = false;
				const box = new Instance("TextBox");
				box.Parent = gui;
				gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
				defer(() => {
					box.ReleaseFocus();
					gui.Destroy();
				});
				box.CaptureFocus();
				eventually(() => serverMove() === Vector2.zero, "the release on the server", 5);
				box.ReleaseFocus();
				eventually(() => input.SaGameplay.IsEnabled(), "the context back on");
				move.Bindings.Virtual.Fire(new Vector2(0, 1));
				eventually(() => serverMove() === new Vector2(0, 1), "Move again on the server", 5);
				move.Bindings.Virtual.Fire(Vector2.zero);
				eventually(() => serverMove() === Vector2.zero, "Move back to rest", 5);
			});
		});
	}
}
