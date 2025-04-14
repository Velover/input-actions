import { UserInputService } from "@rbxts/services";
import { ECustomKey, InputKeyCode } from "../Models";

export namespace InputKeyCodeHelper {
	/**
	 * Data for visually representing an input key
	 */
	export interface IVisualInputKeyCodeData {
		readonly Name: string;
		readonly ImageId: string;
	}

	/**
	 * Get visual representation data for a specific input key code
	 */
	export function GetVisualInputKeyCodeData(
		inputKeyCode?: InputKeyCode,
		useCustomImages: boolean = true,
	): IVisualInputKeyCodeData {
		if (inputKeyCode === undefined)
			return {
				Name: "",
				ImageId: "",
			};

		let image = "";
		const name = GetInputKeyCodeName(inputKeyCode);

		if (useCustomImages) {
			image = GetImageForKey(inputKeyCode);
		} else if (!IsCustomKey(inputKeyCode) && inputKeyCode.EnumType !== Enum.UserInputType) {
			image = UserInputService.GetImageForKeyCode(inputKeyCode as Enum.KeyCode);
		}

		return {
			Name: name,
			ImageId: image,
		};
	}

	export function IsCustomKey(input_key_code: InputKeyCode): input_key_code is ECustomKey {
		return typeIs(input_key_code, "string");
	}

	export function GetInputKeyCodeName(inputKeyCode: InputKeyCode) {
		return typeIs(inputKeyCode, "string") ? inputKeyCode : inputKeyCode.Name;
	}

	export function GetImageForKey(keycode: InputKeyCode) {
		return keyCodesMap.get(keycode) ?? "";
	}
}

const keyCodesMap = new Map<InputKeyCode, string>([
	[Enum.KeyCode.U, "rbxassetid://17164171424"],
	[Enum.KeyCode.Five, "rbxassetid://17164184242"],
	[Enum.KeyCode.B, "rbxassetid://17164182862"],
	[Enum.UserInputType.MouseWheel, "rbxassetid://17164175886"],
	[Enum.KeyCode.Insert, "rbxassetid://17164177453"],
	[Enum.KeyCode.W, "rbxassetid://17164171052"],
	[Enum.KeyCode.F9, "rbxassetid://17164179222"],
	[Enum.KeyCode.PageUp, "rbxassetid://17164174200"],
	[Enum.KeyCode.Three, "rbxassetid://17164184445"],
	[Enum.KeyCode.Plus, "rbxassetid://17164174067"],
	[Enum.KeyCode.Asterisk, "rbxassetid://17164183034"],
	[Enum.KeyCode.RightBracket, "rbxassetid://17164182331"],
	[Enum.KeyCode.F2, "rbxassetid://17164180129"],
	[Enum.KeyCode.F12, "rbxassetid://17164178634"],
	[Enum.KeyCode.Space, "rbxassetid://17164171928"],
	[Enum.KeyCode.S, "rbxassetid://17164172818"],
	[Enum.KeyCode.Up, "rbxassetid://17164171320"],
	[Enum.KeyCode.Four, "rbxassetid://17164184342"],
	[Enum.KeyCode.O, "rbxassetid://17164174938"],
	[Enum.KeyCode.F11, "rbxassetid://17164178865"],
	[Enum.KeyCode.H, "rbxassetid://17164177748"],
	[Enum.KeyCode.LessThan, "rbxassetid://17164177063"],
	[Enum.KeyCode.Return, "rbxassetid://17164180817"],
	[Enum.KeyCode.F6, "rbxassetid://17164179581"],
	[Enum.KeyCode.F5, "rbxassetid://17164179726"],
	[Enum.KeyCode.V, "rbxassetid://17164171198"],
	[Enum.KeyCode.Question, "rbxassetid://17164185563"],
	[Enum.KeyCode.Nine, "rbxassetid://17164183617"],
	[Enum.KeyCode.L, "rbxassetid://17164176934"],
	[Enum.KeyCode.X, "rbxassetid://17164170805"],
	[Enum.KeyCode.Semicolon, "rbxassetid://17164172533"],
	[Enum.UserInputType.MouseMovement, "rbxassetid://17164175520"],
	[Enum.KeyCode.One, "rbxassetid://17164184706"],
	[Enum.KeyCode.G, "rbxassetid://17164177883"],
	[Enum.KeyCode.N, "rbxassetid://17164175216"],
	[Enum.KeyCode.Escape, "rbxassetid://17164180538"],
	[Enum.KeyCode.LeftBracket, "rbxassetid://17164182420"],
	[Enum.UserInputType.MouseButton3, "rbxassetid://17164176366"],
	[Enum.KeyCode.Zero, "rbxassetid://17164184873"],
	[Enum.KeyCode.Seven, "rbxassetid://17164183931"],
	[Enum.KeyCode.RightAlt, "rbxassetid://17164183213"],
	[Enum.KeyCode.Z, "rbxassetid://17164170232"],
	[Enum.KeyCode.M, "rbxassetid://17164176674"],
	[Enum.KeyCode.Six, "rbxassetid://17164184131"],
	[Enum.KeyCode.C, "rbxassetid://17164182218"],
	[Enum.KeyCode.Backspace, "rbxassetid://17164182513"],
	[Enum.KeyCode.F, "rbxassetid://17164180448"],
	[Enum.UserInputType.MouseButton2, "rbxassetid://17164176250"],
	[Enum.KeyCode.End, "rbxassetid://17164181281"],
	[Enum.KeyCode.KeypadPlus, "rbxassetid://17164173955"],
	[Enum.KeyCode.Minus, "rbxassetid://17164176583"],
	[Enum.KeyCode.Eight, "rbxassetid://17164183773"],
	[Enum.KeyCode.Print, "rbxassetid://17164173817"],
	[Enum.KeyCode.NumLock, "rbxassetid://17164175073"],
	[Enum.KeyCode.Tilde, "rbxassetid://17164171596"],
	[Enum.KeyCode.T, "rbxassetid://17164171856"],
	[Enum.KeyCode.Q, "rbxassetid://17164173679"],
	[Enum.KeyCode.Down, "rbxassetid://17164181555"],
	[Enum.KeyCode.Right, "rbxassetid://17164173155"],
	[Enum.KeyCode.Two, "rbxassetid://17164184536"],
	[Enum.KeyCode.R, "rbxassetid://17164173353"],
	[Enum.KeyCode.E, "rbxassetid://17164181436"],
	[Enum.KeyCode.Y, "rbxassetid://17164170504"],
	[Enum.KeyCode.Slash, "rbxassetid://17164172092"],
	[Enum.KeyCode.F7, "rbxassetid://17164179459"],
	[Enum.KeyCode.PageDown, "rbxassetid://17164174448"],
	[Enum.KeyCode.A, "rbxassetid://17164183473"],
	[Enum.KeyCode.Tab, "rbxassetid://17164171761"],
	[Enum.KeyCode.GreaterThan, "rbxassetid://17164177171"],
	[Enum.KeyCode.LeftShift, "rbxassetid://17164172459"],
	[Enum.KeyCode.F4, "rbxassetid://17164179911"],
	[Enum.KeyCode.D, "rbxassetid://17164181789"],
	[Enum.KeyCode.F8, "rbxassetid://17164179350"],
	[Enum.KeyCode.F10, "rbxassetid://17164179041"],
	[Enum.KeyCode.CapsLock, "rbxassetid://17164182096"],
	[Enum.KeyCode.QuotedDouble, "rbxassetid://17164173486"],
	[Enum.KeyCode.F3, "rbxassetid://17164180019"],
	[Enum.KeyCode.P, "rbxassetid://17164174692"],
	[Enum.KeyCode.Left, "rbxassetid://17164176834"],
	[Enum.KeyCode.Home, "rbxassetid://17164177604"],
	[Enum.KeyCode.I, "rbxassetid://17164185671"],
	[Enum.KeyCode.KeypadEnter, "rbxassetid://17164180648"],
	[Enum.KeyCode.J, "rbxassetid://17164177374"],
	[Enum.KeyCode.LeftControl, "rbxassetid://17164181979"],
	[Enum.KeyCode.K, "rbxassetid://17164177296"],
	[Enum.KeyCode.F1, "rbxassetid://17164180325"],
	[Enum.KeyCode.RightShift, "rbxassetid://17164172362"],
	[Enum.UserInputType.MouseButton1, "rbxassetid://17164176481"],
	[Enum.KeyCode.Delete, "rbxassetid://17164185786"],

	// Gamepad keys
	[ECustomKey.Thumbstick1Right, "rbxassetid://17164630825"],
	[Enum.KeyCode.DPadUp, "rbxassetid://17164632019"],
	[Enum.KeyCode.ButtonR2, "rbxassetid://17164626784"],
	[Enum.KeyCode.DPadDown, "rbxassetid://17164632333"],
	[Enum.KeyCode.DPadRight, "rbxassetid://17164632118"],
	[ECustomKey.Thumbstick1Up, "rbxassetid://17164630628"],
	[Enum.KeyCode.ButtonY, "rbxassetid://17164625585"],
	[ECustomKey.Thumbstick1Left, "rbxassetid://17164631028"],
	[Enum.KeyCode.Thumbstick2, "rbxassetid://17164629151"],
	[Enum.KeyCode.Menu, "rbxassetid://17164626282"],
	[Enum.KeyCode.ButtonL1, "rbxassetid://17164629964"],
	[Enum.KeyCode.ButtonL2, "rbxassetid://17164633611"],
	[Enum.KeyCode.ButtonR1, "rbxassetid://17164627364"],
	[Enum.KeyCode.Thumbstick1, "rbxassetid://17164631447"],
	[ECustomKey.Thumbstick2Right, "rbxassetid://17164628221"],
	[ECustomKey.Thumbstick2Up, "rbxassetid://17164628019"],
	[Enum.KeyCode.ButtonX, "rbxassetid://17164625869"],
	[Enum.KeyCode.ButtonR3, "rbxassetid://17164627156"],
	[Enum.KeyCode.ButtonB, "rbxassetid://17164632497"],
	[Enum.KeyCode.ButtonA, "rbxassetid://17164632783"],
	[Enum.KeyCode.DPadLeft, "rbxassetid://17164632209"],
	[Enum.KeyCode.ButtonL3, "rbxassetid://17164629782"],
	[ECustomKey.Thumbstick2Left, "rbxassetid://17164628428"],
]);
