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
	test,
} from "@flamework-experimental/testing";
import { RawInputHandler } from "@rbxts/input-actions";
import { Players, StarterPlayer } from "@rbxts/services";
import { frames, nearlyEqual } from "./helpers";

/** Where the PlayerModule keeps its contexts under this project (probed locations) */
function playerModuleContexts(): Instance {
	if (getProject() === "authority") {
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
	const context = expectDefined(playerModuleContexts().WaitForChild(contextName, 10), contextName);
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

function usesIas() {
	const project = getProject();
	return project === "ias" || project === "authority";
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
				if (!usesIas()) return;
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
				if (!usesIas()) return;
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
				if (!usesIas()) return;
				RawInputHandler.Initialize();
				const context = playerModuleAction("CharacterContext", "MoveAction").Parent as InputContext;
				defer(() => RawInputHandler.ControlSetEnabled(true));
				RawInputHandler.ControlSetEnabled(false);
				expectFalse(context.Enabled);
				RawInputHandler.ControlSetEnabled(true);
				expectTrue(context.Enabled);
			});

			test("legacy player scripts: the controls module and the forked camera input", () => {
				if (usesIas()) return;
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
