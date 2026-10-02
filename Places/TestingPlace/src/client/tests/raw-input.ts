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
import { RawInputHandler } from "@rbxts/input-actions";
import { Players, StarterPlayer } from "@rbxts/services";
import { usesIasPlayerScripts } from "shared/fixtures/projects";
import { frames, nearlyEqual } from "./helpers";

/**
 * Where the PlayerModule reads a context under this project (probed locations). Under Server
 * Authority the ControlModule reads the player's copy; the CameraModule always reads the module's own.
 */
function playerModuleContexts(contextName: string): Instance {
	if (getProject() === "authority" && contextName !== "CameraContext") {
		return expectDefined(
			Players.LocalPlayer.WaitForChild("InputContexts", 10),
			"LocalPlayer.InputContexts",
		);
	}
	const playerModule = expectDefined(
		StarterPlayer.WaitForChild("PlayerModule", 10),
		"StarterPlayer.PlayerModule",
	);
	return expectDefined(
		playerModule.WaitForChild("InputContexts", 10),
		"PlayerModule.InputContexts",
	);
}

function playerModuleAction(contextName: string, actionName: string): InputAction {
	const context = expectDefined(
		playerModuleContexts(contextName).WaitForChild(contextName, 10),
		contextName,
	);
	return expectDefined(context.WaitForChild(actionName, 10), actionName) as InputAction;
}

/** A Scriptable binding added to one of the PlayerModule's actions for the test */
function scriptableBinding(action: InputAction, reset: unknown) {
	const binding = new Instance("InputBinding");
	binding.Name = "InputActionsTestBinding";
	binding.Type = Enum.InputBindingType.Scriptable;
	binding.Parent = action;
	defer(() => {
		binding.Fire(reset);
		binding.Destroy();
	});
	return binding;
}

/** The IAS player scripts run under this project; `default` and `immediate` have the legacy ones */
function usesIas() {
	return usesIasPlayerScripts();
}

/** RawInputHandler over the IAS PlayerModule, with the legacy fallback (design spec §10) */
@Provider({ activeIn: ["testing"] })
export class RawInputTests implements OnStart {
	onStart() {
		defineTests("raw-input", () => {
			test("Initialize finds the PlayerModule's input for this project", () => {
				RawInputHandler.Initialize();
				RawInputHandler.Initialize(); // twice is fine
				expectEqual(RawInputHandler.IsUsingInputActionSystem(), usesIas());
				expectEqual(typeOf(RawInputHandler.GetMoveVector()), "Vector3");
				expectEqual(typeOf(RawInputHandler.GetRotation()), "Vector2");
				expectEqual(typeOf(RawInputHandler.GetZoomDelta()), "number");
			});

			test("the move vector is CharacterContext.MoveAction as Vector3(x, 0, -y)", () => {
				if (!usesIas())
					return skip("the IAS player scripts only (ias, ias-immediate, authority, touch)");
				RawInputHandler.Initialize();
				const move = scriptableBinding(
					playerModuleAction("CharacterContext", "MoveAction"),
					Vector2.zero,
				);
				// under Server Authority the fired value lands on the next simulation step
				move.Fire(new Vector2(0, 1));
				eventually(
					() => RawInputHandler.GetMoveVector() === new Vector3(0, 0, -1),
					"forward as -Z",
				);
				move.Fire(new Vector2(0.5, 0));
				eventually(() => RawInputHandler.GetMoveVector() === new Vector3(0.5, 0, 0), "right as +X");
				expectTrue(nearlyEqual(RawInputHandler.GetMoveVector(false, true).Magnitude, 1));
				expectTrue(nearlyEqual(RawInputHandler.GetMoveVector(true).Magnitude, 0.5));
				move.Fire(Vector2.zero);
				eventually(() => RawInputHandler.GetMoveVector(true, true) === Vector3.zero, "no movement");
			});

			test("rotation and zoom read the camera actions, gated by MouseInputSetEnabled", () => {
				if (!usesIas())
					return skip("the IAS player scripts only (ias, ias-immediate, authority, touch)");
				RawInputHandler.Initialize();
				const rotation = scriptableBinding(
					playerModuleAction("CameraContext", "CameraRotationAction"),
					Vector2.zero,
				);
				const zoom = scriptableBinding(playerModuleAction("CameraContext", "CameraZoomAction"), 0);
				defer(() => RawInputHandler.MouseInputSetEnabled(true));

				rotation.Fire(new Vector2(10, 0));
				zoom.Fire(4);
				eventually(() => RawInputHandler.GetRotation().X > 0, "a rotation");
				eventually(() => RawInputHandler.GetZoomDelta() > 0, "a zoom");
				expectTrue(nearlyEqual(RawInputHandler.GetRotation().Y, 0));

				RawInputHandler.MouseInputSetEnabled(false);
				frames(2);
				expectEqual(RawInputHandler.GetRotation(), Vector2.zero);
				expectEqual(RawInputHandler.GetZoomDelta(), 0);
				RawInputHandler.MouseInputSetEnabled(true);
				eventually(() => RawInputHandler.GetRotation().X > 0, "the rotation back");
			});

			test("ControlSetEnabled switches CharacterContext", () => {
				if (!usesIas())
					return skip("the IAS player scripts only (ias, ias-immediate, authority, touch)");
				RawInputHandler.Initialize();
				const context = playerModuleAction("CharacterContext", "MoveAction").Parent as InputContext;
				defer(() => RawInputHandler.ControlSetEnabled(true));
				RawInputHandler.ControlSetEnabled(false);
				expectFalse(context.Enabled);
				RawInputHandler.ControlSetEnabled(true);
				expectTrue(context.Enabled);
			});

			test("Server Authority: a CharacterContext found later takes the controls' state; the one left gets its own back", () => {
				if (getProject() !== "authority") return skip("the authority project only");
				RawInputHandler.Initialize();
				const copy = playerModuleContexts("CharacterContext");
				const characterContext = expectDefined(
					copy.FindFirstChild("CharacterContext"),
					"the player's CharacterContext",
				) as InputContext;
				const moduleContext = expectDefined(
					StarterPlayer.FindFirstChild("PlayerModule")
						?.FindFirstChild("InputContexts")
						?.FindFirstChild("CharacterContext"),
					"the PlayerModule's CharacterContext",
				) as InputContext;
				const moduleWas = moduleContext.Enabled;
				defer(() => {
					copy.Name = "InputContexts";
					RawInputHandler.GetMoveVector();
					RawInputHandler.ControlSetEnabled(true);
				});
				RawInputHandler.ControlSetEnabled(false);
				expectFalse(characterContext.Enabled);
				// on this client only, the player's copy goes away for a moment: the module's is read
				copy.Name = "RawInputAway";
				RawInputHandler.GetMoveVector();
				frames(2);
				expectFalse(moduleContext.Enabled, "the module's context takes the state meanwhile");
				expectTrue(characterContext.Enabled, "the copy gets its own Enabled back");
				RawInputHandler.ControlSetEnabled(true);
				RawInputHandler.ControlSetEnabled(false);
				copy.Name = "InputContexts";
				RawInputHandler.GetMoveVector();
				frames(2);
				expectFalse(characterContext.Enabled, "the copy takes the state once it is back");
				expectEqual(moduleContext.Enabled, moduleWas, "the module's context gets its own back");
			});

			test("legacy player scripts: the controls module and the forked camera input", () => {
				if (usesIas()) return skip("the legacy player scripts only (default, immediate)");
				RawInputHandler.Initialize();
				expectEqual(RawInputHandler.GetMoveVector(true, true), Vector3.zero);
				RawInputHandler.ControlSetEnabled(false);
				RawInputHandler.ControlSetEnabled(true);
				RawInputHandler.MouseInputSetEnabled(false);
				frames(2);
				expectEqual(RawInputHandler.GetRotation(), Vector2.zero);
				RawInputHandler.MouseInputSetEnabled(true);
			});
		});
	}
}
