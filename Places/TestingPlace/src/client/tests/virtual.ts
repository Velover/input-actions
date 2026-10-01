import { defer } from "@flamework-experimental/testing";
import { GuiService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";
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

/** The GUI inset: `SendMouseButton` positions are screen positions, GUI positions start below it */
export function guiInset(): Vector2 {
	const [inset] = GuiService.GetGuiInset();
	return inset;
}

/** The screen position of a GUI object's centre, as `SendMouseButton` takes it */
export function screenCenter(gui: GuiObject): Vector2 {
	return gui.AbsolutePosition.add(gui.AbsoluteSize.div(2)).add(guiInset());
}

/**
 * A screen point over the 3D world, clear of CoreGui (the top bar and the corners), of the touch
 * controls (the thumbstick on the left, the jump button bottom right) and of the test buttons
 */
export function emptyPoint(): Vector2 {
	const viewport = Workspace.CurrentCamera!.ViewportSize;
	return new Vector2(math.floor(viewport.X * 0.65), math.floor(viewport.Y * 0.3));
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

	constructor(virtualInput: VirtualInput) {
		this.Device = virtualInput;
		defer(() => this.ReleaseAll());
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

	/** Holds a mouse button down at a screen position (a touch under a simulated phone) */
	MouseDown(position: Vector2, button: Enum.UserInputType = Enum.UserInputType.MouseButton1) {
		if (this._buttons.has(button)) error(`${button.Name} is already down`, 2);
		this.Device.SendMouseButton(position, button, true);
		this._buttons.set(button, position);
	}

	MouseUp(button: Enum.UserInputType = Enum.UserInputType.MouseButton1) {
		const position = this._buttons.get(button);
		if (position === undefined) return;
		this._buttons.delete(button);
		this.Device.SendMouseButton(position, button, false);
	}

	/** A click (or a tap) at a screen position, a few frames between down and up */
	Click(position: Vector2) {
		this.MouseDown(position);
		frames(2);
		this.MouseUp();
		frames(2);
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
