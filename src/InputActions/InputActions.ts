import { IsServerAuthority as IsServerAuthorityImpl } from "./AuthorityMode";
import { SanitizeBindings as SanitizeBindingsImpl } from "./BindingsJson";
import * as Builders from "./Builders";
import type * as Keys from "./KeyGroups";
import {
	PreferredDevice as PreferredDeviceImpl,
	PreferredDeviceChanged as PreferredDeviceChangedSignal,
} from "./PreferredDevice";
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

	/**
	 * Checks and freezes a schema: the contexts, their options and actions, each action's bindings.
	 * Creates no instances: put it in a shared module and require it on client and server. A binding
	 * with keys is named after its device (`KeyboardAndMouse`, `Gamepad`, `Touch`) and takes only
	 * its keys; several bindings of one device go in `{ Main, <Extra> }`
	 * @example
	 * export const InputSchema = InputActions.Schema({
	 * 	Gameplay: {
	 * 		Priority: 2000,
	 * 		Actions: {
	 * 			Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space, Gamepad: Enum.KeyCode.ButtonA }),
	 * 			Move: InputActions.Direction2D({
	 * 				KeyboardAndMouse: { Up: Enum.KeyCode.W, Down: Enum.KeyCode.S, Left: Enum.KeyCode.A, Right: Enum.KeyCode.D },
	 * 				Gamepad: Enum.KeyCode.Thumbstick1,
	 * 			}),
	 * 		},
	 * 	},
	 * });
	 */
	export const Schema = Builders.Schema;

	/**
	 * Client: gets or creates the contexts, actions and bindings (in `ReplicatedStorage.Inputs`, or
	 * `options.Folder`), and returns the typed root handle. Waits for `game.Loaded`; throws on the
	 * server. Call it once and share the handle
	 * @example
	 * export const Input = InputActions.Create(InputSchema);
	 * Input.Gameplay.Actions.Jump.Pressed.Connect(() => print("jump"));
	 * const move = Input.Gameplay.Actions.Move.GetState(); // Vector2
	 */
	export const Create = CreateImpl;

	/**
	 * Server: provides the Server Authority contexts to every player, now and as they join. Returns a
	 * function that stops providing
	 * @example
	 * InputActions.ProvideToPlayers(InputSchema);
	 */
	export const ProvideToPlayers = ProvideToPlayersImpl;

	/**
	 * Server: typed read-only handles over one player's Server Authority contexts (`GetState`,
	 * `StateChanged`, `Pressed`/`Released`). Waits up to `options.Timeout` (10 s) for them, then throws
	 * @example
	 * const input = InputActions.ForPlayer(InputSchema, player);
	 * input.Character.Actions.Dash.Pressed.Connect(() => print(`${player.Name} dashed`));
	 */
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
	 * server) and returns a clean save, e.g. to clean what a client sends before storing it. Never
	 * `JSONDecode` a client's save yourself: input nested deep enough ends the server process
	 * @example
	 * const clean = InputActions.SanitizeBindings(InputSchema, jsonFromClient);
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
	export const PreferredDevice = PreferredDeviceImpl;

	/**
	 * Client: fires with the device each time `PreferredDevice()` changes (a key pressed after a
	 * tap, a gamepad plugged in). `MicroGamepad` and `Gamepad` both read `"Gamepad"`, so a switch
	 * between them fires nothing, and it never fires the same device twice in a row. It listens to
	 * `PreferredInput` from the first time it is read, once for the game. On the server it never
	 * fires. A menu or a keybind hint re-renders on it
	 * @example
	 * InputActions.PreferredDeviceChanged.Connect((device) => {
	 * 	hint.Text = `Jump: ${Jump.Describe(device)}`;
	 * });
	 */
	export declare const PreferredDeviceChanged: RBXScriptSignal<(device: Device) => void>;

	/** Ready-made context schemas */
	export namespace Presets {
		/**
		 * Menu navigation: Navigate, Accept, Cancel, NextPage, PreviousPage and Scroll, on the
		 * keyboard and mouse and the gamepad
		 * @example
		 * Menu: InputActions.Presets.UiNavigation({ Priority: 3000, Sink: true, Enabled: false }),
		 */
		export const UiNavigation = UiNavigationPreset;
		/** `UiNavigation`'s options: the context's */
		export type UiNavigationOptions = IUiNavigationOptions;
		/** What `UiNavigation` returns: a context schema */
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
	/** The handle of a binding declared `InputActions.Scriptable`: `Fire(value)` */
	export type ScriptableBindingHandle<A extends Enum.InputActionType> =
		T.IScriptableBindingHandle<A>;
	/**
	 * A device's extra bindings by name, as a binding handle's `Extras()` gives them (`H`: their
	 * handles' type, the device's)
	 */
	export type ExtraBindings<H> = T.IExtraBindings<H>;
	/** A context handle; Server Authority contexts add `IsLinkedToServer`, `LinkedToServer` and `WhenLinkedToServer` */
	export type ContextHandle<C extends T.IContextSchema> = T.ContextHandle<C>;
	/** The handle `Create` returns */
	export type Handle<S extends Record<string, T.IContextSchema>> = T.InputHandle<S>;
	/** The handle `ForPlayer` returns */
	export type ServerHandle<S extends Record<string, T.IContextSchema>> = T.ServerInputHandle<S>;
	/** A server handle on one action of type `A` (`ForPlayer`): `GetState` and `StateChanged` */
	export type ServerAction<A extends Enum.InputActionType> = T.IServerActionHandle<A>;

	/** A context in a schema: `{ ServerAuthority?, Priority?, Sink?, Enabled?, Actions }` */
	export type ContextSchema = T.IContextSchema;
	/**
	 * A schema: what `Schema` returns, or `{ Contexts }` written without it (a misspelt context
	 * option is a compile error there too). A helper generic over it can pass it to `Create`
	 */
	export type InputSchema<S extends Record<string, T.IContextSchema>> = T.ICheckedInputSchema<S>;
	/** An action in a schema, as a builder returns it */
	export type ActionDefinition<
		A extends Enum.InputActionType,
		B = unknown,
		TP extends boolean = boolean,
	> = T.IActionDefinition<A, B, TP>;
	/** A builder's options: `TrackPrevious`, `DisplayName`, `Enabled` */
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
	/** The key slots of a binding of action type `A`: what `Capture` and `Clear` take */
	export type CaptureSlot<A extends Enum.InputActionType> = T.CaptureSlot<A>;
	/** `Capture`'s options: `{ Cancel? }` */
	export type CaptureOptions = T.ICaptureOptions;
	/** What `CaptureChord` passes its callback */
	export type Chord = T.IChord;
	/** `CaptureChord`'s options: `{ Cancel?, Timeout? }` */
	export type ChordCaptureOptions = T.IChordCaptureOptions;
	/** What `ImportBindings` returns: the paths applied, and the entries skipped with a reason */
	export type ImportResult = T.IImportResult;
	/** A save's entry `ImportBindings` skipped: `{ Path, Reason }` */
	export type SkippedBinding = T.ISkippedBinding;
	/** What `FindConflicts(binding)` lists: another binding of the device that shares a key with it */
	export type BindingConflict = T.IBindingConflict;
	/** What `FindConflicts()` lists: two bindings of one device that share a key */
	export type ConflictPair = T.IConflictPair;
	/** `OnTap`'s options */
	export type TapOptions = T.ITapOptions;
	/** `OnDoubleTap`'s options */
	export type DoubleTapOptions = T.IDoubleTapOptions;
	/** `OnHold`'s options */
	export type HoldOptions = T.IHoldOptions;
	/** `OnLongPress`'s options */
	export type LongPressOptions = T.ILongPressOptions;

	/** `Create`'s options: `Folder`, `PlayerFolderName`, `Timeout`, `ResetOnFocusLoss` */
	export type CreateOptions = T.ICreateOptions;
	/** `ProvideToPlayers`' options: `Folder`, `PlayerFolderName` */
	export type ProvideOptions = T.IProvideOptions;
	/** `ForPlayer`'s options: `PlayerFolderName`, `Timeout` */
	export type ForPlayerOptions = T.IForPlayerOptions;

	/** Keyboard keys, gamepad buttons and TV-remote buttons */
	export type ButtonKey = Keys.ButtonKey;
	/** `MouseLeftButton`, `MouseRightButton`, `MouseMiddleButton` */
	export type MouseButtonKey = Keys.MouseButtonKey;
	/** Single-axis analog keys: triggers and per-axis thumbstick directions (0..1) */
	export type AxisKey = Keys.AxisKey;
	/** `Thumbstick1`, `Thumbstick2` */
	export type StickKey = Keys.StickKey;
	/** Keys that read as a one-axis rate: `MouseWheel`, `TrackpadPinch`, `TouchPinch` */
	export type Delta1DKey = Keys.Delta1DKey;
	/** Keys that read as a two-axis rate: `MouseDelta`, `TouchDelta`, `TrackpadPan` */
	export type Delta2DKey = Keys.Delta2DKey;
	/** `MousePosition`, `TouchPosition` */
	export type PositionKey = Keys.PositionKey;
	/** The keys a Bool action's `KeyCode` takes: buttons, mouse buttons, axes, `TouchPosition` */
	export type BoolKey = Keys.BoolKey;
	/** The keys a Direction1D action's `KeyCode` takes: buttons, axes, one-axis rates */
	export type Direction1DKey = Keys.Direction1DKey;
	/** The keys a Direction2D action's `KeyCode` takes: sticks and two-axis rates */
	export type Direction2DKey = Keys.Direction2DKey;
	/** The keys a composite direction (`Up`, `Down`...) takes: buttons and axes */
	export type CompositeKey = Keys.CompositeKey;
	/** The keys a modifier takes: buttons (keyboard keys, gamepad buttons) */
	export type ModifierKey = Keys.ModifierKey;
	/** Every gamepad key: buttons, triggers, the D-pad, sticks and their directions, the TV remote's */
	export type GamepadKey = Keys.GamepadKey;
	/** `TouchPosition`, `TouchDelta`, `TouchPinch` */
	export type TouchKey = Keys.TouchKey;
	/** Every other key: the keyboard's, the mouse's, the trackpad's */
	export type KeyboardAndMouseKey = Keys.KeyboardAndMouseKey;
}

// `PreferredDeviceChanged` is made the first time it is read, which connects it to `PreferredInput`:
// the namespace declares it, and its table answers it through `__index`
setmetatable(InputActions as unknown as object, {
	__index: (_, key) =>
		key === "PreferredDeviceChanged" ? PreferredDeviceChangedSignal() : undefined,
});
