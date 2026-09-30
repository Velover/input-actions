import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectFalse,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import {
	CheckBindingSpec,
	IsKeyAllowed,
	KeyFromName,
} from "@rbxts/input-actions/out/InputActions/BindingRules";
import {
	AXIS_KEYS,
	DELTA_1D_KEYS,
	DELTA_2D_KEYS,
	DEPRECATED_KEYS,
	GetKeyGroup,
	MOUSE_BUTTON_KEYS,
	POSITION_KEYS,
	RESERVED_KEYS,
	STICK_KEYS,
} from "@rbxts/input-actions/out/InputActions/KeyGroups";

const K = Enum.KeyCode;

/** The key groups and per-type rules, checked at runtime (design spec §3) */
@Provider({ activeIn: ["testing"] })
export class RulesTests implements OnStart {
	onStart() {
		defineTests("rules", () => {
			test("the key groups match the spec", () => {
				expectEqual(RESERVED_KEYS.size(), 6);
				expectEqual(DEPRECATED_KEYS.size(), 5);
				expectEqual(MOUSE_BUTTON_KEYS.size(), 3);
				expectEqual(AXIS_KEYS.size(), 10);
				expectEqual(STICK_KEYS.size(), 2);
				expectEqual(DELTA_1D_KEYS.size(), 3);
				expectEqual(DELTA_2D_KEYS.size(), 3);
				expectEqual(POSITION_KEYS.size(), 2);
				// every other key is a Button
				expectEqual(GetKeyGroup(K.Space), GetKeyGroup(K.ButtonA));
				expectEqual(GetKeyGroup(K.ButtonCenter), GetKeyGroup(K.E));
				// the deprecated alias is the same item
				expectEqual(GetKeyGroup(K.Unknown), GetKeyGroup(K.None));
			});

			test("Bool KeyCode: Button, MouseButton, Axis, TouchPosition", () => {
				for (const key of [
					K.Space,
					K.ButtonA,
					K.MouseLeftButton,
					K.ButtonR2,
					K.Thumbstick1Up,
					K.TouchPosition,
				]) {
					expectTrue(IsKeyAllowed("Bool", "KeyCode", key), key.Name);
				}
				for (const key of [
					K.MouseDelta,
					K.MouseWheel,
					K.Thumbstick1,
					K.MousePosition,
					K.Escape,
					K.None,
					K.MouseX,
				]) {
					expectFalse(IsKeyAllowed("Bool", "KeyCode", key), key.Name);
				}
			});

			test("Direction1D KeyCode: Button, Axis, Delta1D", () => {
				for (const key of [K.E, K.ButtonL2, K.MouseWheel, K.TrackpadPinch, K.TouchPinch]) {
					expectTrue(IsKeyAllowed("Direction1D", "KeyCode", key), key.Name);
				}
				for (const key of [K.MouseDelta, K.Thumbstick1, K.MouseLeftButton, K.MousePosition]) {
					expectFalse(IsKeyAllowed("Direction1D", "KeyCode", key), key.Name);
				}
			});

			test("Direction2D KeyCode: Stick, Delta2D", () => {
				for (const key of [
					K.Thumbstick1,
					K.Thumbstick2,
					K.MouseDelta,
					K.TouchDelta,
					K.TrackpadPan,
				]) {
					expectTrue(IsKeyAllowed("Direction2D", "KeyCode", key), key.Name);
				}
				for (const key of [K.W, K.ButtonR2, K.MouseWheel, K.MousePosition, K.Thumbstick1Up]) {
					expectFalse(IsKeyAllowed("Direction2D", "KeyCode", key), key.Name);
				}
			});

			test("Direction3D has no KeyCode; ViewportPosition takes Position keys only", () => {
				expectFalse(IsKeyAllowed("Direction3D", "KeyCode", K.W));
				expectFalse(IsKeyAllowed("Direction3D", "KeyCode", K.Thumbstick1));
				expectTrue(IsKeyAllowed("ViewportPosition", "KeyCode", K.MousePosition));
				expectTrue(IsKeyAllowed("ViewportPosition", "KeyCode", K.TouchPosition));
				expectFalse(IsKeyAllowed("ViewportPosition", "KeyCode", K.MouseDelta));
			});

			test("composite directions: Button, Axis, and only the directions of the type", () => {
				expectTrue(IsKeyAllowed("Direction2D", "Up", K.W));
				expectTrue(IsKeyAllowed("Direction2D", "Left", K.Thumbstick1Left));
				expectFalse(IsKeyAllowed("Direction2D", "Up", K.MouseDelta));
				expectFalse(IsKeyAllowed("Direction2D", "Up", K.MouseLeftButton));
				expectFalse(IsKeyAllowed("Direction2D", "Forward", K.W));
				expectFalse(IsKeyAllowed("Direction1D", "Left", K.A));
				expectTrue(IsKeyAllowed("Direction3D", "Backward", K.S));
				expectFalse(IsKeyAllowed("Bool", "Up", K.W));
				expectFalse(IsKeyAllowed("ViewportPosition", "Up", K.W));
			});

			test("modifiers: Button keys, never on ViewportPosition", () => {
				expectTrue(IsKeyAllowed("Bool", "PrimaryModifier", K.LeftControl));
				expectTrue(IsKeyAllowed("Direction3D", "SecondaryModifier", K.LeftShift));
				expectFalse(IsKeyAllowed("Bool", "PrimaryModifier", K.MouseDelta));
				expectFalse(IsKeyAllowed("Bool", "PrimaryModifier", K.ButtonL2));
				expectFalse(IsKeyAllowed("Bool", "PrimaryModifier", K.MouseLeftButton));
				expectFalse(IsKeyAllowed("ViewportPosition", "PrimaryModifier", K.LeftControl));
			});

			test("binding specs: one input source, known properties, ResponseCurve on sticks", () => {
				expectEqual(CheckBindingSpec("Bool", K.Space), undefined);
				expectEqual(
					CheckBindingSpec("Bool", { KeyCode: K.ButtonR2, PressedThreshold: 0.6 }),
					undefined,
				);
				expectEqual(
					CheckBindingSpec("Direction2D", { Up: K.W, Down: K.S, Vector2Scale: new Vector2(1, 2) }),
					undefined,
				);
				expectEqual(
					CheckBindingSpec("Direction2D", { KeyCode: K.Thumbstick1, ResponseCurve: 2 }),
					undefined,
				);
				expectTrue(
					CheckBindingSpec("Direction2D", { KeyCode: K.Thumbstick1, Up: K.W }) !== undefined,
				);
				expectTrue(
					CheckBindingSpec("Direction2D", { KeyCode: K.MouseDelta, ResponseCurve: 2 }) !==
						undefined,
				);
				expectTrue(
					CheckBindingSpec("Direction1D", { KeyCode: K.ButtonR2, PressedThreshold: 0.5 }) !==
						undefined,
				);
				expectTrue(CheckBindingSpec("Bool", { KeyCode: K.E, Scale: 2 }) !== undefined);
				expectTrue(
					CheckBindingSpec("Bool", { KeyCode: K.E, PressedThreshold: 0 / 0 }) !== undefined,
				);
				expectTrue(CheckBindingSpec("Bool", "Space") !== undefined);
				expectTrue(
					CheckBindingSpec("ViewportPosition", {
						KeyCode: K.MousePosition,
						PrimaryModifier: K.E,
					}) !== undefined,
				);
			});

			test("key names resolve like Enum.KeyCode.FromName", () => {
				expectEqual(KeyFromName("Space"), K.Space);
				expectEqual(KeyFromName("Unknown"), K.None);
				expectEqual(KeyFromName("None"), K.None);
				expectEqual(KeyFromName("Nope"), undefined);
			});
		});
	}
}
