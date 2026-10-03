import { UserInputService } from "@rbxts/services";
import { ActionTypeName, IsSlotOf, MODIFIER_SLOTS } from "./BindingRules";

// A keybind as text (design spec §6, F2): what a rebinding menu or a hint shows for a binding,
// "Ctrl + S" or "W / A / S / D".

const K = Enum.KeyCode;

/**
 * Readable names of the keys `UserInputService:GetStringForKeyCode` names no better than the enum
 * does. Measured in Studio (2026-10-03, every KeyCode, `default` and `touch`): it gives the character
 * a key types on the player's keyboard layout (`Space` gives " ", `Comma` ",", `Hash` "3": the key
 * pressed with Shift), and the enum's `Name` for every key that types none (`LeftControl`, `Return`,
 * `KeypadZero`, `ButtonA`, `Thumbstick1`, `MouseLeftButton`, `MouseWheel`, `TouchPosition`...). Never
 * "". Gamepad keys use the Xbox names, as the KeyCodes do (`UserInputService:GetImageForKeyCode`
 * gives the platform's icon)
 */
const KEY_NAMES = new Map<Enum.KeyCode, string>([
	[K.Space, "Space"],
	[K.Return, "Enter"],
	[K.Escape, "Esc"],
	[K.LeftControl, "Ctrl"],
	[K.RightControl, "Right Ctrl"],
	[K.LeftShift, "Shift"],
	[K.RightShift, "Right Shift"],
	[K.LeftAlt, "Alt"],
	[K.RightAlt, "Right Alt"],
	[K.LeftMeta, "Meta"],
	[K.RightMeta, "Right Meta"],
	[K.LeftSuper, "Super"],
	[K.RightSuper, "Right Super"],
	[K.CapsLock, "Caps Lock"],
	[K.NumLock, "Num Lock"],
	[K.ScrollLock, "Scroll Lock"],
	[K.PageUp, "Page Up"],
	[K.PageDown, "Page Down"],
	[K.SysReq, "SysRq"],
	[K.Print, "Print Screen"],
	[K.KeypadZero, "Num 0"],
	[K.KeypadOne, "Num 1"],
	[K.KeypadTwo, "Num 2"],
	[K.KeypadThree, "Num 3"],
	[K.KeypadFour, "Num 4"],
	[K.KeypadFive, "Num 5"],
	[K.KeypadSix, "Num 6"],
	[K.KeypadSeven, "Num 7"],
	[K.KeypadEight, "Num 8"],
	[K.KeypadNine, "Num 9"],
	[K.KeypadPeriod, "Num ."],
	[K.KeypadDivide, "Num /"],
	[K.KeypadMultiply, "Num *"],
	[K.KeypadMinus, "Num -"],
	[K.KeypadPlus, "Num +"],
	[K.KeypadEnter, "Num Enter"],
	[K.KeypadEquals, "Num ="],
	[K.MouseLeftButton, "Left Click"],
	[K.MouseRightButton, "Right Click"],
	[K.MouseMiddleButton, "Middle Click"],
	[K.MouseWheel, "Mouse Wheel"],
	[K.MouseDelta, "Mouse Movement"],
	[K.MousePosition, "Mouse Position"],
	[K.TrackpadPan, "Trackpad Pan"],
	[K.TrackpadPinch, "Trackpad Pinch"],
	[K.TouchPosition, "Touch"],
	[K.TouchDelta, "Drag"],
	[K.TouchPinch, "Pinch"],
	[K.ButtonA, "A"],
	[K.ButtonB, "B"],
	[K.ButtonX, "X"],
	[K.ButtonY, "Y"],
	[K.ButtonL1, "LB"],
	[K.ButtonR1, "RB"],
	[K.ButtonL2, "LT"],
	[K.ButtonR2, "RT"],
	[K.ButtonL3, "Left Stick Press"],
	[K.ButtonR3, "Right Stick Press"],
	[K.ButtonStart, "Start"],
	[K.ButtonSelect, "Select"],
	[K.DPadUp, "D-Pad Up"],
	[K.DPadDown, "D-Pad Down"],
	[K.DPadLeft, "D-Pad Left"],
	[K.DPadRight, "D-Pad Right"],
	[K.Thumbstick1, "Left Stick"],
	[K.Thumbstick2, "Right Stick"],
	[K.Thumbstick1Up, "Left Stick Up"],
	[K.Thumbstick1Down, "Left Stick Down"],
	[K.Thumbstick1Left, "Left Stick Left"],
	[K.Thumbstick1Right, "Left Stick Right"],
	[K.Thumbstick2Up, "Right Stick Up"],
	[K.Thumbstick2Down, "Right Stick Down"],
	[K.Thumbstick2Left, "Right Stick Left"],
	[K.Thumbstick2Right, "Right Stick Right"],
	[K.ButtonCenter, "Remote Center"],
	[K.ButtonBack, "Remote Back"],
	[K.ButtonUp, "Remote Up"],
	[K.ButtonDown, "Remote Down"],
	[K.ButtonLeft, "Remote Left"],
	[K.ButtonRight, "Remote Right"],
]);

/**
 * A key as a player reads it: a name above, else what `GetStringForKeyCode` gives (a character
 * key's character on the player's layout, upper case: Q reads "A" on AZERTY), else the enum's name
 * (`Tab`, `F5`, `Home`...: readable as it is)
 */
export function KeyText(key: Enum.KeyCode): string {
	const named = KEY_NAMES.get(key);
	if (named !== undefined) return named;
	const [ok, text] = pcall(() => UserInputService.GetStringForKeyCode(key));
	// The enum's name back (a key that types no character), or nothing readable: the name
	if (!ok || !typeIs(text, "string") || text === key.Name || text.match("%S")[0] === undefined)
		return key.Name;
	return text.upper();
}

/** The composite directions as they read: Up, Left, Down, Right (W / A / S / D), Forward, Backward */
const READING_ORDER = ["Up", "Left", "Down", "Right", "Forward", "Backward"] as const;

/**
 * A binding as text (see `IBindingHandle.Describe`): its `DisplayName` when it has one; else its
 * modifiers then its key, joined by " + " ("Ctrl + S"), or its composite directions in reading
 * order joined by " / " ("W / A / S / D"; with modifiers, "Shift + (W / A / S / D)"); "" when it
 * has no key. Only the slots the action type uses count, and IAS ignores the composite directions
 * beside a `KeyCode`, so they do too
 */
export function DescribeBinding(actionType: ActionTypeName, binding: InputBinding): string {
	if (binding.DisplayName !== "") return binding.DisplayName;
	const keys = new Array<string>();
	if (binding.KeyCode !== K.None && IsSlotOf(actionType, "KeyCode"))
		keys.push(KeyText(binding.KeyCode));
	else {
		for (const slot of READING_ORDER) {
			const key = binding[slot];
			if (key !== K.None && IsSlotOf(actionType, slot)) keys.push(KeyText(key));
		}
	}
	if (keys.isEmpty()) return "";
	const main = keys.join(" / ");
	const modifiers = new Array<string>();
	for (const slot of MODIFIER_SLOTS) {
		const key = binding[slot];
		if (key !== K.None && IsSlotOf(actionType, slot)) modifiers.push(KeyText(key));
	}
	if (modifiers.isEmpty()) return main;
	return `${modifiers.join(" + ")} + ${keys.size() > 1 ? `(${main})` : main}`;
}
