import { defer } from "@flamework-experimental/testing";
import {
	ContextActionService,
	GuiService,
	Players,
	RunService,
	UserInputService,
	Workspace,
} from "@rbxts/services";
import { frames } from "./helpers";

// Real keyboard and mouse input through `UserInputService:CreateVirtualInput()`, which IAS treats as
// hardware (design spec §12). Every key or button a test presses is released when the test ends,
// pass or fail: pressing one that is already down throws, and a held key leaks into later tests.
// Under the `touch` project Studio simulates a phone, and the mouse events arrive as touch.

let device: VirtualInput | undefined;
let unavailable: string | undefined;

/** The session's VirtualInput, made once; `undefined` with the reason where it can't be had */
function getDevice(): VirtualInput | undefined {
	if (device !== undefined || unavailable !== undefined) return device;
	const [ok, created] = pcall(() => UserInputService.CreateVirtualInput());
	if (ok && created !== undefined) device = created as unknown as VirtualInput;
	else unavailable = ok ? "CreateVirtualInput returned nothing" : tostring(created);
	return device;
}

/** The GUI inset: the top bar, above where GUI positions start (58 px here) */
export function guiInset(): Vector2 {
	const [inset] = GuiService.GetGuiInset();
	return inset;
}

/** A ScreenGui over the whole screen, kept for the session: its corner is where the screen starts */
let wholeScreen: ScreenGui | undefined;

/**
 * Where the screen starts in GUI coordinates (`AbsolutePosition`, `InputObject.Position`): the
 * corner of a ScreenGui that ignores the GUI inset and the safe area (`ScreenInsets.None`).
 * VirtualInput's positions count from there. In a desktop window that is (0, -58), the GUI inset
 * alone. Under a simulated phone the safe area moves GUI positions in from the screen's edge too:
 * (-47, -58) on the iPhone 14 in landscape (probed, hunt round 4), so the inset alone puts a tap
 * 47 px left of its target. Before the layout has run (a window that renders nothing), the inset.
 */
function screenOrigin(): Vector2 {
	if (wholeScreen === undefined || wholeScreen.Parent === undefined) {
		const gui = new Instance("ScreenGui");
		gui.Name = "InputActionsWholeScreen";
		gui.IgnoreGuiInset = true;
		gui.ScreenInsets = Enum.ScreenInsets.None;
		gui.ResetOnSpawn = false;
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		wholeScreen = gui;
	}
	for (let index = 0; index < 10 && wholeScreen.AbsoluteSize.X === 0; index++) frames(1);
	if (wholeScreen.AbsoluteSize.X === 0) return guiInset().mul(-1);
	return wholeScreen.AbsolutePosition;
}

/** A GUI position (`AbsolutePosition`) as the screen position `SendMouseButton` takes */
export function toScreen(guiPosition: Vector2): Vector2 {
	return guiPosition.sub(screenOrigin());
}

/** The screen position of a GUI object's centre, as `SendMouseButton` takes it */
export function screenCenter(gui: GuiObject): Vector2 {
	return toScreen(gui.AbsolutePosition.add(gui.AbsoluteSize.div(2)));
}

/**
 * A screen point over the 3D world, clear of CoreGui (the top bar and the corners), of the touch
 * controls (the thumbstick on the left, the jump button bottom right) and of the test buttons. The
 * viewport's corner is at minus the GUI inset in GUI coordinates
 */
export function emptyPoint(): Vector2 {
	const viewport = Workspace.CurrentCamera!.ViewportSize;
	const inViewport = new Vector2(math.floor(viewport.X * 0.65), math.floor(viewport.Y * 0.3));
	return toScreen(inViewport.sub(guiInset()));
}

/**
 * For a failure message, when a click at a screen `point` didn't reach what it should have: what
 * else could have taken it or moved it. The cursor's behaviour (locked, it clicks at the centre),
 * the camera's distance from its focus (first person locks the cursor), the GUI objects under the
 * point, CAS actions bound to the left button, and the enabled IAS contexts that bind it or sink.
 */
export function pointerReport(point: Vector2): string {
	const parts = new Array<string>();
	const buttons = UserInputService.GetMouseButtonsPressed().map(
		(input) => input.UserInputType.Name,
	);
	parts.push(
		`MouseBehavior ${UserInputService.MouseBehavior.Name}, the mouse at ${UserInputService.GetMouseLocation()}, buttons down: ${buttons.size() === 0 ? "none" : buttons.join(", ")}`,
	);
	const camera = Workspace.CurrentCamera;
	if (camera !== undefined) {
		const distance = camera.CFrame.Position.sub(camera.Focus.Position).Magnitude;
		parts.push(
			`camera ${camera.CameraType.Name}, ${math.round(distance * 10) / 10} studs from its focus, CameraMode ${Players.LocalPlayer.CameraMode.Name}`,
		);
	}
	const guiPoint = point.add(screenOrigin());
	const playerGui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui");
	const under = new Array<string>();
	if (playerGui !== undefined) {
		for (const gui of playerGui.GetGuiObjectsAtPosition(guiPoint.X, guiPoint.Y)) {
			under.push(`${gui.GetFullName()}${gui.Active ? " (Active)" : ""}`);
		}
	}
	parts.push(`PlayerGui at ${guiPoint}: ${under.size() === 0 ? "nothing" : under.join(", ")}`);
	const bound = new Array<string>();
	for (const [name, info] of ContextActionService.GetAllBoundActionInfo()) {
		const takes = info.inputTypes.some(
			(kind) => kind === Enum.UserInputType.MouseButton1 || kind === Enum.KeyCode.MouseLeftButton,
		);
		if (takes) bound.push(`${name} at ${info.priorityLevel}`);
	}
	parts.push(`CAS on the left button: ${bound.size() === 0 ? "none" : bound.join(", ")}`);
	const contexts = new Array<string>();
	for (const service of game.GetChildren()) {
		const [ok, descendants] = pcall(() => service.GetDescendants());
		if (!ok) continue;
		for (const context of descendants) {
			if (!context.IsA("InputContext") || !context.Enabled) continue;
			const left = context
				.GetDescendants()
				.some(
					(binding) =>
						binding.IsA("InputBinding") && binding.KeyCode === Enum.KeyCode.MouseLeftButton,
				);
			if (!left && !context.Sink) continue;
			contexts.push(
				`${context.GetFullName()} (${context.Priority}${context.Sink ? ", sinks" : ""}${left ? ", binds the left button" : ""})`,
			);
		}
	}
	parts.push(
		`enabled contexts that bind the left button or sink: ${contexts.size() === 0 ? "none" : contexts.join(", ")}`,
	);
	parts.push(
		`TextBox focused: ${UserInputService.GetFocusedTextBox()?.GetFullName() ?? "none"}, selected: ${GuiService.SelectedObject?.GetFullName() ?? "none"}, menu open: ${GuiService.MenuIsOpen}`,
	);
	return parts.join("; ");
}

/** Whether the window renders: GUI layout and hit tests need it (a display that is off stops it) */
export function isRendering(): boolean {
	let steps = 0;
	const connection = RunService.RenderStepped.Connect(() => steps++);
	const deadline = os.clock() + 0.5;
	while (steps < 2 && os.clock() < deadline) RunService.Heartbeat.Wait();
	connection.Disconnect();
	return steps > 0;
}

/** A ScreenGui for the test, above everything else, removed after the test */
export function testGui(name = "InputActionsRealInput"): ScreenGui {
	const gui = new Instance("ScreenGui");
	gui.Name = name;
	gui.ResetOnSpawn = false;
	gui.DisplayOrder = 1000;
	gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
	defer(() => gui.Destroy());
	return gui;
}

/** A TextButton in the middle of the screen, a little above centre (clear of the touch controls) */
export function testButton(gui: GuiObject | ScreenGui, name = "Button", x = 0.45): TextButton {
	const button = new Instance("TextButton");
	button.Name = name;
	button.Text = name;
	button.AnchorPoint = new Vector2(0.5, 0.5);
	button.Position = UDim2.fromScale(x, 0.45);
	button.Size = UDim2.fromOffset(120, 70);
	button.Parent = gui;
	return button;
}

/**
 * Why a click on `gui` can't be tested now, if it can't: the window renders nothing (no layout, no
 * hit tests), or the object has no size yet. Waits a few frames for the layout first.
 */
export function clickProblem(gui: GuiObject): string | undefined {
	if (!isRendering())
		return "the Studio window renders nothing (is the display off?): GUI clicks need layout";
	for (let index = 0; index < 10 && gui.AbsoluteSize.X === 0; index++) frames(1);
	if (gui.AbsoluteSize.X === 0) return `${gui.GetFullName()} has no size: the GUI was not laid out`;
	return undefined;
}

/**
 * Real input for one test. Keys and mouse buttons held when the test ends are released then, and
 * the release is given two frames to land before the next test. The wheel notches the test sent are
 * sent back, so the player's camera ends the test at the zoom it started with.
 */
export class RealInput {
	readonly Device: VirtualInput;
	private readonly _keys = new Set<Enum.KeyCode>();
	private readonly _buttons = new Map<Enum.UserInputType, Vector2>();
	/** The wheel notches sent and not yet sent back, oldest first */
	private readonly _notches = new Array<number>();
	/** `WindowFocusReleased` events since the test began */
	private _focusLosses = 0;
	/** A mouse button went up, and no frames were waited since: the next press waits for them */
	private _mouseReleased = false;

	constructor(virtualInput: VirtualInput) {
		this.Device = virtualInput;
		const focus = UserInputService.WindowFocusReleased.Connect(() => this._focusLosses++);
		defer(() => focus.Disconnect());
		defer(() => this.ReleaseAll());
	}

	/**
	 * For a failure message: whether the Studio window lost focus during the test (the user working
	 * in another window). The focus-loss reset of a root handle made with the default
	 * `ResetOnFocusLoss` then released what the test held. Empty when it didn't.
	 */
	FocusNote(): string {
		if (this._focusLosses === 0) return "";
		return (
			` (the Studio window lost focus ${this._focusLosses} time(s) during the test: the ` +
			"focus-loss reset releases what root handles with the default ResetOnFocusLoss held)"
		);
	}

	Press(key: Enum.KeyCode) {
		if (this._keys.has(key)) error(`${key.Name} is already held`, 2);
		this.Device.SendKey(true, key, false);
		this._keys.add(key);
	}

	Release(key: Enum.KeyCode) {
		if (!this._keys.delete(key)) return;
		this.Device.SendKey(false, key, false);
	}

	/** Presses and releases a key, a few frames apart */
	Tap(key: Enum.KeyCode) {
		this.Press(key);
		frames(2);
		this.Release(key);
		frames(2);
	}

	/**
	 * Holds a mouse button down at a screen position (a touch under a simulated phone). Two frames
	 * after a button went up first: a press sent right after a release landed can be lost, with no
	 * `InputBegan` and nothing pressed (measured under `default`: a click on a button, then at once,
	 * after its `Activated`, a press elsewhere: 5 of 13 lost; a frame or two later, none of 13; with
	 * this wait, none of 60 under `default` and `ias-immediate`)
	 */
	MouseDown(position: Vector2, button: Enum.UserInputType = Enum.UserInputType.MouseButton1) {
		if (this._buttons.has(button)) error(`${button.Name} is already down`, 2);
		if (this._mouseReleased) frames(2);
		this._mouseReleased = false;
		this.Device.SendMouseButton(position, button, true);
		this._buttons.set(button, position);
	}

	MouseUp(button: Enum.UserInputType = Enum.UserInputType.MouseButton1) {
		const position = this._buttons.get(button);
		if (position === undefined) return;
		this._buttons.delete(button);
		this.Device.SendMouseButton(position, button, false);
		this._mouseReleased = true;
	}

	/** A click (or a tap) at a screen position, a few frames between down and up, and after */
	Click(position: Vector2) {
		this.MouseDown(position);
		frames(2);
		this.MouseUp();
		frames(2);
		this._mouseReleased = false;
	}

	/**
	 * Mouse wheel notches at a screen position: positive away from the user. They zoom the player's
	 * camera too, and four in from where the tests start put it in first person, which locks the
	 * cursor at the centre (clicks on a button then miss it): the test's notches are sent back when it
	 * ends. A notch the other way right after one sends it back at once.
	 */
	Wheel(notches: number, position: Vector2 = emptyPoint()) {
		this.Device.SendPointerAction(position, { Wheel: notches });
		const last = this._notches.size() - 1;
		if (last >= 0 && this._notches[last] === -notches) this._notches.pop();
		else this._notches.push(notches);
	}

	/** Moves the mouse by `delta` pixels; registers only while the cursor is locked */
	MouseDelta(delta: Vector2) {
		this.Device.SendMouseDelta(delta);
	}

	ReleaseAll() {
		const held = this._keys.size() > 0 || this._buttons.size() > 0;
		for (const key of this._keys) pcall(() => this.Device.SendKey(false, key, false));
		this._keys.clear();
		for (const [button, position] of this._buttons) {
			pcall(() => this.Device.SendMouseButton(position, button, false));
		}
		this._buttons.clear();
		if (held) frames(2);
		// Last first, two frames apart: the camera's zoom steps undo each other in that order
		while (this._notches.size() > 0) {
			const notches = this._notches.pop()!;
			pcall(() => this.Device.SendPointerAction(emptyPoint(), { Wheel: -notches }));
			frames(2);
		}
	}
}

/**
 * Real input for the running test, or the reason there is none: VirtualInput is a Studio API, and
 * input can't be sent while the Roblox menu is open (it throws).
 */
export function realInput(): RealInput | string {
	const virtualInput = getDevice();
	if (virtualInput === undefined) return `no VirtualInput here: ${unavailable}`;
	if (GuiService.MenuIsOpen) return "the Roblox menu is open: VirtualInput throws then";
	return new RealInput(virtualInput);
}
