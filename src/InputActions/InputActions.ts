import { UserInputService } from "@rbxts/services";
import { IsServerAuthority as IsServerAuthorityImpl } from "./AuthorityMode";
import { SanitizeBindings as SanitizeBindingsImpl } from "./BindingsJson";
import * as Builders from "./Builders";
import type * as Keys from "./KeyGroups";
import { UiNavigation as UiNavigationPreset } from "./Presets";
import type { IUiNavigationOptions, UiNavigationActions } from "./Presets";
import { Create as CreateImpl } from "./Runtime";
import {
	ForPlayer as ForPlayerImpl,
	ProvideToPlayers as ProvideToPlayersImpl,
} from "./ServerAuthority";
import type * as T from "./Types";

/**
 * A typed wrapper over Roblox's Input Action System. Describe the contexts with `Schema` and the
 * builders (plain data, safe on both realms), then `Create` the handle on the client.
 */
export namespace InputActions {
	/** Marks a binding driven only from code: its handle gets `Fire(value)` */
	export const Scriptable = Builders.SCRIPTABLE;

	/** A Bool action (`boolean`): keys, buttons, mouse buttons, triggers through thresholds */
	export const Bool = Builders.Bool;
	/** A Direction1D action (`number`): triggers, `Up`/`Down` composites, mouse wheel, pinch */
	export const Direction1D = Builders.Direction1D;
	/** A Direction2D action (`Vector2`): thumbsticks, mouse/touch delta, `Up`/`Down`/`Left`/`Right` composites */
	export const Direction2D = Builders.Direction2D;
	/** A Direction3D action (`Vector3`): six-direction composites */
	export const Direction3D = Builders.Direction3D;
	/** A ViewportPosition action (`Vector2` in pixels): mouse or touch position */
	export const ViewportPosition = Builders.ViewportPosition;

	/** Checks and freezes a schema. Creates no instances: safe to require on client and server */
	export const Schema = Builders.Schema;

	/** Client: gets or creates the contexts, actions and bindings, and returns the typed handle */
	export const Create = CreateImpl;

	/** Server: provides the Server Authority contexts to every player, now and as they join */
	export const ProvideToPlayers = ProvideToPlayersImpl;

	/** Server: typed read-only handles over one player's Server Authority contexts */
	export const ForPlayer = ForPlayerImpl;

	/**
	 * Either realm, best-effort: whether the place runs Server Authority
	 * (`Workspace.AuthorityMode = Server`), which scripts can't read. It reads the reason
	 * `workspace.Terrain:CanSetNetworkOwnership()` gives: under Server Authority it names
	 * `AuthorityMode`. `undefined` when the reason is not one the package knows (Roblox reworded
	 * it). Never throws.
	 */
	export const IsServerAuthority = IsServerAuthorityImpl;

	/**
	 * Runs the `ImportBindings` validation against the schema alone (no instances; works on the
	 * server) and returns a clean save, e.g. to clean what a client sends before storing it.
	 */
	export function SanitizeBindings<S extends Record<string, T.IContextSchema>>(
		schema: T.ISchema<S>,
		json: string,
	): string;
	export function SanitizeBindings<S extends Record<string, T.IContextSchema>>(
		schema: T.ICheckedInputSchema<S>,
		json: string,
	): string;
	export function SanitizeBindings<S extends Record<string, T.IContextSchema>>(
		schema: T.ICheckedInputSchema<S>,
		json: string,
	): string {
		return SanitizeBindingsImpl(schema, json);
	}

	/**
	 * Client: the device the player uses, as the binding name that holds its keys:
	 * `UserInputService.PreferredInput`, with the TV remote (`MicroGamepad`) as `"Gamepad"`. Roblox
	 * counts a gamepad as preferred as soon as one is plugged in, before any of its buttons is
	 * pressed. A rebinding menu shows `action.Bindings[InputActions.PreferredDevice()]`, and has
	 * nothing to capture on `"Touch"`.
	 */
	export function PreferredDevice(): Device {
		const preferred = UserInputService.PreferredInput;
		if (preferred === Enum.PreferredInput.Touch) return "Touch";
		if (preferred === Enum.PreferredInput.Gamepad || preferred === Enum.PreferredInput.MicroGamepad)
			return "Gamepad";
		return "KeyboardAndMouse";
	}

	export namespace Presets {
		/** Menu navigation: Navigate, Accept, Cancel, NextPage, PreviousPage and Scroll */
		export const UiNavigation = UiNavigationPreset;
		export type UiNavigationOptions = IUiNavigationOptions;
		export type UiNavigationSchema = { Actions: UiNavigationActions } & UiNavigationOptions;
	}

	/**
	 * A device, which names the binding that holds its keys: `"KeyboardAndMouse"`, `"Gamepad"` or
	 * `"Touch"` (the `Enum.PreferredInput` names; the TV remote's keys are the Gamepad's)
	 */
	export type Device = Keys.Device;
	/** The devices with keys to press, which captures listen to: `"KeyboardAndMouse"`, `"Gamepad"` */
	export type CapturableDevice = Keys.CapturableDevice;

	/** Any Bool action handle, for helpers written in user projects */
	export type BoolAction = T.IBoolActionHandle<unknown>;
	/** Any action handle of type `A` */
	export type Action<A extends Enum.InputActionType = Enum.InputActionType> = T.IActionHandle<
		A,
		unknown
	>;
	/**
	 * Any Bool or Direction1D action handle: the ones with a one-field `Capture` and `CaptureChord`,
	 * for a rebinding menu's helpers
	 */
	export type CaptureAction = T.IActionHandle<
		Enum.InputActionType.Bool | Enum.InputActionType.Direction1D,
		unknown
	> &
		T.IActionCapture;
	/** The handle of an action definition */
	export type ActionHandle<D> = T.ActionHandle<D>;
	/**
	 * The handle of device `D`'s binding of an `A` action: `Capture` on the keyboard-and-mouse and
	 * gamepad ones (the default `D`), and on Bool and Direction1D actions `CaptureChord`; none on the
	 * Touch one. With `D` = `Device` (any of the three), the part they share, whose `Set` takes any
	 * device's keys (checked at runtime)
	 */
	export type BindingHandle<
		A extends Enum.InputActionType,
		D extends Device = CapturableDevice,
	> = T.BindingHandleOf<A, D>;
	/**
	 * A binding handle with `CaptureChord`, for helpers generic over the action type (a
	 * `BindingHandle<A>` of a generic `A` doesn't resolve to it)
	 */
	export type ChordBindingHandle<
		A extends Enum.InputActionType.Bool | Enum.InputActionType.Direction1D,
		D extends CapturableDevice = CapturableDevice,
	> = T.IChordBindingHandle<A, D>;
	export type ScriptableBindingHandle<A extends Enum.InputActionType> =
		T.IScriptableBindingHandle<A>;
	/** A context handle; Server Authority contexts add `IsLinkedToServer`, `LinkedToServer` and `WhenLinkedToServer` */
	export type ContextHandle<C extends T.IContextSchema> = T.ContextHandle<C>;
	/** The handle `Create` returns */
	export type Handle<S extends Record<string, T.IContextSchema>> = T.InputHandle<S>;
	/** The handle `ForPlayer` returns */
	export type ServerHandle<S extends Record<string, T.IContextSchema>> = T.ServerInputHandle<S>;
	export type ServerAction<A extends Enum.InputActionType> = T.IServerActionHandle<A>;

	export type ContextSchema = T.IContextSchema;
	/**
	 * A schema: what `Schema` returns, or `{ Contexts }` written without it (a misspelt context
	 * option is a compile error there too). A helper generic over it can pass it to `Create`
	 */
	export type InputSchema<S extends Record<string, T.IContextSchema>> = T.ICheckedInputSchema<S>;
	export type ActionDefinition<
		A extends Enum.InputActionType,
		B = unknown,
		TP extends boolean = boolean,
	> = T.IActionDefinition<A, B, TP>;
	export type ActionOptions<TP extends boolean = boolean> = T.IActionOptions<TP>;
	/** The type of `InputActions.Scriptable` */
	export type Scriptable = T.IScriptable;

	/** The value type of an action type: boolean, number, Vector2, Vector3 or Vector2 */
	export type ActionValue<A extends Enum.InputActionType> = T.ActionValue<A>;
	/** Every form a binding of this action type and device may take (any device's by default) */
	export type BindingShape<
		A extends Enum.InputActionType,
		D extends Device = Device,
	> = T.BindingShape<A, D>;
	/**
	 * Part of an object form, without the key: what `Set` merges into a binding besides the shapes
	 * (`{ PressedThreshold: 0.9 }`)
	 */
	export type BindingPart<
		A extends Enum.InputActionType,
		D extends Device = Device,
	> = T.BindingPart<A, D>;
	/** What `BindingHandle.Get` returns */
	export type BindingData<
		A extends Enum.InputActionType,
		D extends Device = Device,
	> = T.BindingData<A, D>;
	export type CaptureSlot<A extends Enum.InputActionType> = T.CaptureSlot<A>;
	export type CaptureOptions = T.ICaptureOptions;
	/** What `CaptureChord` passes its callback */
	export type Chord = T.IChord;
	export type ChordCaptureOptions = T.IChordCaptureOptions;
	export type ImportResult = T.IImportResult;
	export type SkippedBinding = T.ISkippedBinding;

	export type CreateOptions = T.ICreateOptions;
	export type ProvideOptions = T.IProvideOptions;
	export type ForPlayerOptions = T.IForPlayerOptions;

	/** Keyboard keys, gamepad buttons and TV-remote buttons */
	export type ButtonKey = Keys.ButtonKey;
	export type MouseButtonKey = Keys.MouseButtonKey;
	/** Single-axis analog keys: triggers and per-axis thumbstick directions (0..1) */
	export type AxisKey = Keys.AxisKey;
	export type StickKey = Keys.StickKey;
	export type Delta1DKey = Keys.Delta1DKey;
	export type Delta2DKey = Keys.Delta2DKey;
	export type PositionKey = Keys.PositionKey;
	export type BoolKey = Keys.BoolKey;
	export type Direction1DKey = Keys.Direction1DKey;
	export type Direction2DKey = Keys.Direction2DKey;
	export type CompositeKey = Keys.CompositeKey;
	export type ModifierKey = Keys.ModifierKey;
	/** Every gamepad key: buttons, triggers, the D-pad, sticks and their directions, the TV remote's */
	export type GamepadKey = Keys.GamepadKey;
	/** `TouchPosition`, `TouchDelta`, `TouchPinch` */
	export type TouchKey = Keys.TouchKey;
	/** Every other key: the keyboard's, the mouse's, the trackpad's */
	export type KeyboardAndMouseKey = Keys.KeyboardAndMouseKey;
}
