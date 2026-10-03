import { Players, StarterPlayer, UserInputService, Workspace } from "@rbxts/services";
import { ReleaseOnServer } from "../InputActions/Internal";
import { EveryFrame } from "../Internal/EveryFrame";
import { ICameraInputModule } from "./CameraInput/ICameraInputModule";

/**
 * Reads the default PlayerModule's input: the move vector, camera rotation and zoom. With the IAS
 * player scripts it reads the PlayerModule's contexts (read only); with the legacy player scripts
 * it uses `PlayerModule:GetControls()` and a fork of the legacy CameraInput module.
 */
export namespace RawInputHandler {
	const MIN_TOUCH_SENSITIVITY_FRACTION = 0.25; // 25% sensitivity at 90°
	/** How long Initialize waits for the IAS PlayerModule's contexts to appear */
	const CONTEXTS_TIMEOUT = 10;

	interface IControlModule {
		GetMoveVector(): Vector3;
		Enable(enabled?: boolean): void;
		Disable(): void;
	}

	interface IPlayerModule {
		GetControls(): IControlModule;
	}

	/** The IAS PlayerModule's actions this module reads */
	interface IPlayerModuleActions {
		CharacterContext: InputContext;
		MoveAction: InputAction;
		CameraRotationAction?: InputAction;
		CameraZoomAction?: InputAction;
	}

	let cameraInput: ICameraInputModule | undefined;
	function GetCameraInput(): ICameraInputModule {
		if (cameraInput !== undefined) return cameraInput;
		cameraInput = import("./CameraInput").expect();
		return cameraInput;
	}

	const localPlayer = Players.LocalPlayer;
	let controlModule: IControlModule | undefined;
	let iasActions: IPlayerModuleActions | undefined;
	let mouseInputEnabled = true;
	/** What `ControlSetEnabled` last asked for, applied again to a CharacterContext found later */
	let controlEnabled: boolean | undefined;
	/** The CharacterContexts `ControlSetEnabled` changed, and the `Enabled` each had before */
	const changedContexts = setmetatable(new Map<InputContext, boolean>(), { __mode: "k" });

	let lastZoomDelta = 0;
	let lastRotation = Vector2.zero;

	/**
	 * The PlayerModule's own contexts. Its CameraModule reads the camera actions from these in every
	 * mode, and applies the sensitivity and invert settings to their bindings only.
	 */
	function FindModuleContexts(): Instance | undefined {
		return StarterPlayer.FindFirstChild("PlayerModule")?.FindFirstChild("InputContexts");
	}

	/** Under Server Authority the ControlModule reads the character's actions from the player's copy */
	function FindCharacterContexts(): Instance | undefined {
		return localPlayer.FindFirstChild("InputContexts") ?? FindModuleContexts();
	}

	function ReadActions(): IPlayerModuleActions | undefined {
		const characterContext = FindCharacterContexts()?.FindFirstChild("CharacterContext");
		const moveAction = characterContext?.FindFirstChild("MoveAction");
		if (!characterContext?.IsA("InputContext") || !moveAction?.IsA("InputAction")) return undefined;
		const cameraContext = (FindModuleContexts() ?? FindCharacterContexts())?.FindFirstChild(
			"CameraContext",
		);
		const rotation = cameraContext?.FindFirstChild("CameraRotationAction");
		const zoom = cameraContext?.FindFirstChild("CameraZoomAction");
		return {
			CharacterContext: characterContext,
			MoveAction: moveAction,
			CameraRotationAction: rotation?.IsA("InputAction") ? rotation : undefined,
			CameraZoomAction: zoom?.IsA("InputAction") ? zoom : undefined,
		};
	}

	/**
	 * The actions the PlayerModule reads now; the player's copy wins once it arrives. The controls'
	 * state goes with them: the CharacterContext left behind gets its own `Enabled` back, and the new
	 * one takes what `ControlSetEnabled` last asked for.
	 */
	function GetActions(): IPlayerModuleActions | undefined {
		const folder = FindCharacterContexts();
		if (folder === undefined) return iasActions;
		if (iasActions === undefined || !iasActions.MoveAction.IsDescendantOf(folder)) {
			const previous = iasActions?.CharacterContext;
			iasActions = ReadActions() ?? iasActions;
			const current = iasActions?.CharacterContext;
			if (current !== previous && current !== undefined && controlEnabled !== undefined) {
				if (previous !== undefined) RestoreContext(previous);
				SetCharacterContextEnabled(current, controlEnabled);
			}
		}
		return iasActions;
	}

	/** Whether the IAS player scripts are in use (as opposed to the legacy ones) */
	export function IsUsingInputActionSystem() {
		return iasActions !== undefined;
	}

	/**
	 * Under Server Authority, disabling a context releases the client's state only: the server keeps
	 * the last value it received, so the character would keep walking there (probed). A temporary
	 * Scriptable binding fires the held value then the value at rest, which releases both sides;
	 * Roblox's own bindings are left untouched.
	 */
	function ReleaseCharacterOnServer(context: InputContext) {
		for (const action of context.GetChildren()) {
			// RotationAction carries a setting (the rotation type), not input
			if (!action.IsA("InputAction") || action.Name === "RotationAction") continue;
			ReleaseOnServer(action, "RawInputHandlerRelease");
		}
	}

	/** The PlayerModule never toggles CharacterContext itself: the package owns its `Enabled` */
	function SetCharacterContextEnabled(context: InputContext, value: boolean) {
		if (!changedContexts.has(context)) changedContexts.set(context, context.Enabled);
		if (!value) ReleaseCharacterOnServer(context);
		context.Enabled = value;
	}

	/** Gives a CharacterContext the PlayerModule no longer reads its own `Enabled` back */
	function RestoreContext(context: InputContext) {
		const enabled = changedContexts.get(context);
		if (enabled === undefined) return;
		changedContexts.delete(context);
		if (context.Parent !== undefined) context.Enabled = enabled;
	}

	/**
	 * Turns the character controls on or off. Remembered: under Server Authority, a CharacterContext
	 * that arrives later (the player's copy) takes the same state.
	 */
	export function ControlSetEnabled(value: boolean) {
		controlEnabled = value;
		const actions = GetActions();
		if (actions !== undefined) SetCharacterContextEnabled(actions.CharacterContext, value);
		else controlModule?.Enable(value);
	}

	/** Turns the camera input (`GetRotation`, `GetZoomDelta`) on or off */
	export function MouseInputSetEnabled(value: boolean) {
		mouseInputEnabled = value;
		// The legacy fork owns its CAS bindings; the IAS path only gates what it returns
		if (iasActions === undefined && controlModule !== undefined)
			GetCameraInput().setInputEnabled(value);
	}

	/** This frame's camera rotation input */
	export function GetRotation() {
		return lastRotation;
	}

	/** This frame's camera zoom input */
	export function GetZoomDelta() {
		return lastZoomDelta;
	}

	function GetRawInputVector(): Vector3 {
		const actions = GetActions();
		if (actions !== undefined) {
			// X right, Y forward; Roblox forward is -Z
			const move = actions.MoveAction.GetState() as Vector2;
			return new Vector3(move.X, 0, -move.Y);
		}
		return controlModule?.GetMoveVector() ?? Vector3.zero;
	}

	/**
	 * The character's move input, `X` right and `-Z` forward
	 * @param relativeCamera rotates the vector by the camera's yaw
	 * @param normalized returns the unit vector
	 * @param followFullRotation also applies the camera's pitch and roll
	 */
	export function GetMoveVector(
		relativeCamera?: boolean,
		normalized?: boolean,
		followFullRotation?: boolean,
	) {
		let inputVector = GetRawInputVector();

		//skips the calculation if input vector is Vector3.zero;
		if (inputVector === Vector3.zero) return inputVector;

		//normalized vector;
		inputVector = normalized ? inputVector.Unit : inputVector;

		if (!relativeCamera) return inputVector;

		const currentCamera = Workspace.CurrentCamera!;

		//follows the pitch and roll of the camera as well
		if (followFullRotation) return currentCamera.CFrame.Rotation.PointToWorldSpace(inputVector);

		const [pitch, yaw, roll] = currentCamera.CFrame.ToOrientation();
		//takes the yaw rotation of the camera;
		const rotationCframe = CFrame.fromAxisAngle(Vector3.yAxis, yaw);
		//rotates the vector around y axis;
		return rotationCframe.PointToWorldSpace(inputVector);
	}

	/** Port of CameraInput's touch pitch adjustment: less sensitive swiping away from the horizon */
	function AdjustTouchPitchSensitivity(delta: Vector2): Vector2 {
		const camera = Workspace.CurrentCamera;
		if (camera === undefined) return delta;
		const [pitch] = camera.CFrame.ToEulerAnglesYXZ();
		// do not reduce sensitivity when pitching towards the horizon
		if (delta.Y * pitch >= 0) return delta;
		const curveY = 1 - math.pow((2 * math.abs(pitch)) / math.pi, 0.75);
		const sensitivity =
			curveY * (1 - MIN_TOUCH_SENSITIVITY_FRACTION) + MIN_TOUCH_SENSITIVITY_FRACTION;
		return new Vector2(1, sensitivity).mul(delta);
	}

	function UpdateInput(deltaTime: number) {
		const actions = iasActions !== undefined ? GetActions() : undefined;
		if (actions === undefined && controlModule === undefined) return;
		if (actions === undefined) {
			//--fetching the delta from input
			lastZoomDelta = GetCameraInput().getZoomDelta();
			lastRotation = GetCameraInput().getRotation(deltaTime);
			GetCameraInput().resetInputForFrameEnd();
			return;
		}
		if (!mouseInputEnabled) {
			lastRotation = Vector2.zero;
			lastZoomDelta = 0;
			return;
		}
		// Read only: Roblox's CameraModule already applies sensitivity and invert to its bindings, and
		// disables its actions when it turns camera input off
		let rotation = (
			(actions.CameraRotationAction?.GetState() as Vector2 | undefined) ?? Vector2.zero
		).mul(deltaTime);
		if (UserInputService.PreferredInput === Enum.PreferredInput.Touch)
			rotation = AdjustTouchPitchSensitivity(rotation);
		lastRotation = rotation;
		lastZoomDelta = ((actions.CameraZoomAction?.GetState() as number | undefined) ?? 0) * deltaTime;
	}

	let initialized = false;
	/** Finds the PlayerModule's input (IAS or legacy) and starts reading it every frame */
	export function Initialize() {
		if (initialized) return;
		initialized = true;
		if (!game.IsLoaded()) game.Loaded.Wait();

		const starterModule = StarterPlayer.FindFirstChild("PlayerModule");
		let folder = FindCharacterContexts();
		if (folder === undefined && starterModule !== undefined) {
			folder = starterModule.WaitForChild("InputContexts", CONTEXTS_TIMEOUT);
		}
		if (folder !== undefined) {
			const deadline = os.clock() + CONTEXTS_TIMEOUT;
			iasActions = ReadActions();
			while (iasActions === undefined && os.clock() < deadline) {
				task.wait();
				iasActions = ReadActions();
			}
			if (iasActions === undefined)
				warn("RawInputHandler: the PlayerModule's CharacterContext.MoveAction was not found");
		} else {
			// Legacy player scripts
			const playerScripts = localPlayer.WaitForChild("PlayerScripts") as Folder;
			const playerModuleScript = playerScripts.WaitForChild("PlayerModule") as ModuleScript;
			const playerModule = require(playerModuleScript) as IPlayerModule;
			controlModule = playerModule.GetControls();
			if (controlEnabled !== undefined) controlModule.Enable(controlEnabled);
			GetCameraInput().setInputEnabled(mouseInputEnabled);
		}
		//starts update input cycle
		EveryFrame(UpdateInput, "FetchInput", Enum.RenderPriority.Input.Value + 1);
	}
}
