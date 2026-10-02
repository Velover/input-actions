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
import { InputActions, RawInputHandler } from "@rbxts/input-actions";
import { Players, ReplicatedStorage, StarterPlayer } from "@rbxts/services";
import { R4_PLAYER_FOLDER, R4_REMOTE, R4_SA_SCHEMA } from "shared/fixtures/validator-r4";
import { frames, newFolder } from "./helpers";

// Validator round 4, Server Authority only: contexts and actions declared disabled (design spec
// sections 4, 5 and 8), and RawInputHandler when the player's copy of Roblox's contexts arrives
// after the client's scripts start (section 10).

/** Whether `player.InputContexts` (Roblox's contexts under Server Authority) was there when this module loaded */
const INPUT_CONTEXTS_AT_LOAD = Players.LocalPlayer.FindFirstChild("InputContexts") !== undefined;
const LOADED_AT = os.clock();
let inputContextsArrivedAfter: number | undefined;
if (!INPUT_CONTEXTS_AT_LOAD) {
	const connection = Players.LocalPlayer.ChildAdded.Connect((child) => {
		if (child.Name !== "InputContexts") return;
		inputContextsArrivedAfter = os.clock() - LOADED_AT;
		connection.Disconnect();
	});
}

function describeArrival() {
	if (INPUT_CONTEXTS_AT_LOAD)
		return "player.InputContexts was there when the client's scripts loaded";
	return (
		"player.InputContexts was not there when the client's scripts loaded; it arrived " +
		(inputContextsArrivedAfter !== undefined
			? `${string.format("%.2f", inputContextsArrivedAfter)} s later`
			: "later")
	);
}

function server(...args: unknown[]): unknown {
	const remote = expectDefined(
		ReplicatedStorage.WaitForChild(R4_REMOTE, 10),
		R4_REMOTE,
	) as RemoteFunction;
	return remote.InvokeServer(...args) as unknown;
}

function createR4Input() {
	expectTrue(server("provide") === true, "the server provides R4_SA_SCHEMA");
	const input = InputActions.Create(R4_SA_SCHEMA, {
		Folder: newFolder(),
		PlayerFolderName: R4_PLAYER_FOLDER,
		Timeout: 1000,
	});
	defer(() => input.Destroy());
	eventually(
		() =>
			input.R4Off.IsLinkedToServer() &&
			input.R4On.IsLinkedToServer() &&
			input.R4Ui.IsLinkedToServer(),
		"the handles on the server's copies",
		10,
	);
	return input;
}

/** Waits for the server to read `expected`; fails with what the server's copy looks like */
function expectServerState(
	contextName: string,
	actionName: string,
	expected: unknown,
	what: string,
) {
	const [ok] = pcall(() =>
		eventually(() => server("state", contextName, actionName) === expected, what, 5),
	);
	if (ok) return;
	const contextEnabled = server("enabled", contextName);
	const actionEnabled = server("enabled", contextName, actionName);
	expectEqual(
		server("state", contextName, actionName),
		expected,
		`${what} (on the server: ${contextName}.Enabled = ${contextEnabled}, ` +
			`${contextName}.${actionName}.Enabled = ${actionEnabled})`,
	);
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR4ServerAuthorityTests implements OnStart {
	onStart() {
		defineTests("validator-r4-sa", () => {
			// ---- contexts and actions declared disabled (spec sections 4 and 8: the server's copy
			// takes the schema's Enabled; the client owns Enabled and enables them later)

			test("an enabled action of the server's copy reaches the server (the control)", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const nod = createR4Input().R4On.Actions.Nod;
				defer(() => nod.Fire(false));
				nod.Fire(true);
				expectServerState("R4On", "Nod", true, "the server's Nod pressed");
				nod.Fire(false);
				expectServerState("R4On", "Nod", false, "the server's Nod released");
			});

			test("a Server Authority context declared Enabled: false reaches the server once the client enables it", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const input = createR4Input();
				const poke = input.R4Off.Actions.Poke;
				defer(() => poke.Fire(false));
				input.R4Off.SetEnabled(true);
				expectTrue(input.R4Off.IsEnabled(), "the client's view: enabled");
				poke.Fire(true);
				eventually(() => poke.IsPressed(), "the client's press");
				expectServerState("R4Off", "Poke", true, "the server's Poke pressed");
			});

			test("a Server Authority context declared Enabled: false reaches the server through Request(true)", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const input = createR4Input();
				input.R4Off.SetEnabled(false);
				const release = input.R4Off.Request(true);
				defer(release);
				const poke = input.R4Off.Actions.Poke;
				defer(() => poke.Fire(false));
				poke.Fire(true);
				eventually(() => poke.IsPressed(), "the client's press");
				expectServerState("R4Off", "Poke", true, "the server's Poke pressed");
			});

			test("an action declared Enabled: false reaches the server once the client enables it", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const wave = createR4Input().R4On.Actions.Wave;
				defer(() => wave.Fire(false));
				wave.SetEnabled(true);
				expectTrue(wave.IsEnabled(), "the client's view: enabled");
				wave.Fire(true);
				eventually(() => wave.IsPressed(), "the client's press");
				expectServerState("R4On", "Wave", true, "the server's Wave pressed");
			});

			test("UiNavigation({ ServerAuthority: true, Enabled: false }): an opened menu reaches the server", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				const input = createR4Input();
				const release = input.R4Ui.Request(true);
				defer(release);
				const accept = input.R4Ui.Actions.Accept;
				defer(() => accept.Fire(false));
				accept.Fire(true);
				eventually(() => accept.IsPressed(), "the client's press");
				expectServerState("R4Ui", "Accept", true, "the server's Accept pressed");
			});

			// ---- RawInputHandler (spec section 10)

			test("ControlSetEnabled(false) before the player's InputContexts arrives still turns the controls off", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				RawInputHandler.Initialize();
				const copy = expectDefined(
					Players.LocalPlayer.WaitForChild("InputContexts", 10),
					"player.InputContexts",
				);
				const characterContext = expectDefined(
					copy.WaitForChild("CharacterContext", 10),
					"CharacterContext",
				) as InputContext;
				const moduleContext = StarterPlayer.FindFirstChild("PlayerModule")
					?.FindFirstChild("InputContexts")
					?.FindFirstChild("CharacterContext") as InputContext | undefined;
				const moduleWas = moduleContext?.Enabled;
				// The copy hasn't arrived yet: on this client only, it goes by another name for a moment
				copy.Name = "ValidatorR4NotArrivedYet";
				defer(() => {
					copy.Name = "InputContexts";
					RawInputHandler.ControlSetEnabled(true);
					if (moduleContext !== undefined && moduleWas !== undefined)
						moduleContext.Enabled = moduleWas;
				});
				frames(2);
				RawInputHandler.ControlSetEnabled(false);
				copy.Name = "InputContexts"; // the copy arrives
				frames(3);
				RawInputHandler.GetMoveVector();
				expectFalse(
					characterContext.Enabled,
					`the CharacterContext Roblox's ControlModule reads under Server Authority is still enabled (${describeArrival()})`,
				);
			});
		});
	}
}
