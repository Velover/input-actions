import { Players, StarterPlayer, UserInputService, Workspace } from "@rbxts/services";
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

	let lastZoomDelta = 0;
	let lastRotation = Vector2.zero;

	/** Under Server Authority the PlayerModule reads the player's copy, else its own */
	function FindContextsFolder(): Instance | undefined {
		const playerCopy = localPlayer.FindFirstChild("InputContexts");
		if (playerCopy !== undefined) return playerCopy;
		return StarterPlayer.FindFirstChild("PlayerModule")?.FindFirstChild("InputContexts");
	}

	function ReadActions(folder: Instance): IPlayerModuleActions | undefined {
		const characterContext = folder.FindFirstChild("CharacterContext");
		const moveAction = characterContext?.FindFirstChild("MoveAction");
		if (!characterContext?.IsA("InputContext") || !moveAction?.IsA("InputAction")) return undefined;
		const cameraContext = folder.FindFirstChild("CameraContext");
		const rotation = cameraContext?.FindFirstChild("CameraRotationAction");
		const zoom = cameraContext?.FindFirstChild("CameraZoomAction");
		return {
			CharacterContext: characterContext,
			MoveAction: moveAction,
			CameraRotationAction: rotation?.IsA("InputAction") ? rotation : undefined,
			CameraZoomAction: zoom?.IsA("InputAction") ? zoom : undefined,
		};
	}

	/** The actions of the folder the PlayerModule reads now; the player's copy wins once it arrives */
	function GetActions(): IPlayerModuleActions | undefined {
		const folder = FindContextsFolder();
		if (folder === undefined) return iasActions;
		if (iasActions === undefined || !iasActions.MoveAction.IsDescendantOf(folder)) {
			iasActions = ReadActions(folder) ?? iasActions;
		}
		return iasActions;
	}

	/** Whether the IAS player scripts are in use (as opposed to the legacy ones) */
	export function IsUsingInputActionSystem() {
		return iasActions !== undefined;
	}

	export function ControlSetEnabled(value: boolean) {
		const actions = GetActions();
		// The PlayerModule never toggles CharacterContext itself
		if (actions !== undefined) actions.CharacterContext.Enabled = value;
		else controlModule?.Enable(value);
	}

	export function MouseInputSetEnabled(value: boolean) {
		mouseInputEnabled = value;
		// The legacy fork owns its CAS bindings; the IAS path only gates what it returns
		if (iasActions === undefined && controlModule !== undefined)
			GetCameraInput().setInputEnabled(value);
	}

	export function GetRotation() {
		return lastRotation;
	}

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
		// Read only: Roblox's CameraModule already applies sensitivity and invert to its bindings
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
		let folder = FindContextsFolder();
		if (folder === undefined && starterModule !== undefined) {
			folder = starterModule.WaitForChild("InputContexts", CONTEXTS_TIMEOUT);
		}
		if (folder !== undefined) {
			const deadline = os.clock() + CONTEXTS_TIMEOUT;
			iasActions = ReadActions(folder);
			while (iasActions === undefined && os.clock() < deadline) {
				task.wait();
				iasActions = ReadActions(FindContextsFolder() ?? folder);
			}
			if (iasActions === undefined)
				warn("RawInputHandler: the PlayerModule's CharacterContext.MoveAction was not found");
		} else {
			// Legacy player scripts
			const playerScripts = localPlayer.WaitForChild("PlayerScripts") as Folder;
			const playerModuleScript = playerScripts.WaitForChild("PlayerModule") as ModuleScript;
			const playerModule = require(playerModuleScript) as IPlayerModule;
			controlModule = playerModule.GetControls();
			GetCameraInput().setInputEnabled(mouseInputEnabled);
		}
		//starts update input cycle
		EveryFrame(UpdateInput, "FetchInput", Enum.RenderPriority.Input.Value + 1);
	}
}
