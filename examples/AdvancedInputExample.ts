import {
	ActionsController,
	ECustomKey,
	EVibrationPreset,
	HapticFeedbackController,
	InputActionsInitializationHelper,
	InputConfigController,
	InputContextController,
	InputEchoController,
	KeyCombinationController,
} from "@rbxts/input-actions";
import { RunService } from "@rbxts/services";

// Initialize all controllers
InputActionsInitializationHelper.InitAll();

// Step 1: Set up different input contexts for different game states
// Create the "gameplay" context
const gameplayContext = InputContextController.CreateContext("gameplay");
gameplayContext.Add("Jump", { KeyboardAndMouse: Enum.KeyCode.Space });
gameplayContext.Add("Fire", { KeyboardAndMouse: Enum.UserInputType.MouseButton1 });
gameplayContext.Add("Reload", { KeyboardAndMouse: Enum.KeyCode.R });

// Create the "menu" context
const menuContext = InputContextController.CreateContext("menu");
menuContext.Add("Accept", { KeyboardAndMouse: Enum.KeyCode.Return });
menuContext.Add("Cancel", { KeyboardAndMouse: Enum.KeyCode.Escape });
menuContext.Add("NavigateUp", { KeyboardAndMouse: Enum.KeyCode.Up });
menuContext.Add("NavigateDown", { KeyboardAndMouse: Enum.KeyCode.Down });

// Apply the gameplay context
gameplayContext.Assign();

// Step 2: Configure input echo for repeating input
InputEchoController.ConfigureActionEcho("NavigateDown", 0.4, 0.1);
InputEchoController.ConfigureActionEcho("NavigateUp", 0.4, 0.1);

// Step 3: Configure special key combinations
KeyCombinationController.RegisterCombination("QuickSave", Enum.KeyCode.S, [
	Enum.KeyCode.LeftControl,
]);

KeyCombinationController.RegisterCombination("QuickLoad", Enum.KeyCode.L, [
	Enum.KeyCode.LeftControl,
]);

// Step 4: Configure analog input deadzones
InputConfigController.SetInputDeadzone(Enum.KeyCode.Thumbstick1, 0.15);
InputConfigController.SetInputDeadzone(Enum.KeyCode.Thumbstick2, 0.2);
InputConfigController.SetInputDeadzone(ECustomKey.Thumbstick1Up, 0.15);
InputConfigController.SetInputDeadzone(ECustomKey.Thumbstick1Down, 0.12);

// Step 5: Configure action sensitivity
// Make the "Aim" action require a stronger press on triggers
ActionsController.Add("Aim", 0.3);
InputConfigController.SetActionActivationThreshold("Aim", 0.7);

// Example of switching contexts when opening a menu
let menuOpen = false;
const ToggleMenu = () => {
	menuOpen = !menuOpen;
	// Switch input context based on menu state
	if (menuOpen) {
		gameplayContext.Unassign();
		menuContext.Assign();
	} else {
		menuContext.Unassign();
		gameplayContext.Assign();
	}

	print(`Menu is now ${menuOpen ? "open" : "closed"}`);
};

// Subscribe to input for quicksave/quickload
InputActionsInitializationHelper.InitBasicInputControllers();
ActionsController.Add("OpenMenu", 0.5, [Enum.KeyCode.Tab]);

// ADVANCED FEATURE 3: Multi-key combinations with modifiers
KeyCombinationController.RegisterCombination("Screenshot", Enum.KeyCode.F12);
KeyCombinationController.RegisterCombination("DevConsole", Enum.KeyCode.F9, [
	Enum.KeyCode.LeftShift,
	Enum.KeyCode.LeftControl,
]);

// ADVANCED FEATURE 4: Custom haptic feedback presets
HapticFeedbackController.RegisterPreset("WeaponJam", 0.9, 0.3, 0.4);
HapticFeedbackController.RegisterPreset("LowHealth", 0.5, 0.1, 0.8);

RunService.Heartbeat.Connect(() => {
	// Check for our quick actions
	if (ActionsController.IsJustPressed("QuickSave")) {
		print("Quick saved game!");
		// Trigger haptic feedback for save success
		HapticFeedbackController.VibratePreset(EVibrationPreset.Success);
	}

	if (ActionsController.IsJustPressed("QuickLoad")) {
		print("Quick loaded game!");
		// Trigger haptic feedback for load
		HapticFeedbackController.Vibrate(0.7, 0.5, 0.3);
	}

	if (ActionsController.IsJustPressed("OpenMenu")) {
		ToggleMenu();
	}

	// Demonstrate activation threshold
	if (ActionsController.IsJustPressed("Aim")) {
		print("Precision aiming activated (required 70% press strength)");
	}

	// Demonstrate combinations
	if (ActionsController.IsJustPressed("DevConsole")) {
		print("Developer console activated with Ctrl+Shift+F9!");
	}

	// Demonstrate custom haptic feedback
	if (ActionsController.IsJustPressed("Screenshot")) {
		print("Screenshot taken!");
		HapticFeedbackController.VibratePreset("WeaponJam");
	}
});
