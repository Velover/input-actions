import { RunService } from "@rbxts/services";
import { IsPackageMade } from "./Registry";

// Name matching against an existing tree (design spec §4). A binding for slot `S` of action `A`
// matches a child InputBinding named `S` or `A .. S`: the Input Action Manager names its bindings
// `<Action><Device>`, e.g. `JumpKeyboardAndMouse`.

export const DEFAULT_PLAYER_FOLDER_NAME = "Inputs";
/** Where Roblox's own PlayerModule keeps its contexts under Server Authority */
export const PLAYER_MODULE_FOLDER_NAME = "InputContexts";
export const DEFAULT_TIMEOUT = 10;

export function CheckPlayerFolderName(name: string) {
	if (name === PLAYER_MODULE_FOLDER_NAME) {
		error(
			`InputActions: PlayerFolderName can't be "${PLAYER_MODULE_FOLDER_NAME}": Roblox's PlayerModule uses it`,
			3,
		);
	}
}

export function FindBinding(
	action: Instance,
	actionName: string,
	slot: string,
): InputBinding | undefined {
	for (const name of [slot, actionName + slot]) {
		const child = action.FindFirstChild(name);
		if (child !== undefined && child.IsA("InputBinding")) return child;
	}
	return undefined;
}

/** Whether a binding named `bindingName` under action `actionName` fills one of `slots` */
export function MatchesSlot(
	actionName: string,
	bindingName: string,
	slots: readonly string[],
): boolean {
	for (const slot of slots) {
		if (bindingName === slot || bindingName === actionName + slot) return true;
	}
	return false;
}

export function FindContext(
	parent: Instance,
	name: string,
	path: string,
): InputContext | undefined {
	const child = parent.FindFirstChild(name);
	if (child === undefined) return undefined;
	if (!child.IsA("InputContext"))
		error(
			`InputActions: ${path}: ${child.GetFullName()} is a ${child.ClassName}, not an InputContext`,
			0,
		);
	return child;
}

export function FindAction(
	context: Instance,
	name: string,
	actionType: Enum.InputActionType,
	path: string,
): InputAction | undefined {
	const child = context.FindFirstChild(name);
	if (child === undefined) return undefined;
	if (!child.IsA("InputAction"))
		error(
			`InputActions: ${path}: ${child.GetFullName()} is a ${child.ClassName}, not an InputAction`,
			0,
		);
	CheckActionType(child, actionType, path);
	return child;
}

export function CheckActionType(
	action: InputAction,
	actionType: Enum.InputActionType,
	path: string,
) {
	if (action.Type !== actionType) {
		error(
			`InputActions: ${path}: ${action.GetFullName()} is a ${action.Type.Name} action, but the schema declares ${actionType.Name}`,
			0,
		);
	}
}

export function CreateAction(
	name: string,
	actionType: Enum.InputActionType,
	displayName?: string,
	enabled?: boolean,
) {
	const action = new Instance("InputAction");
	action.Name = name;
	action.Type = actionType;
	if (displayName !== undefined) action.DisplayName = displayName;
	if (enabled !== undefined) action.Enabled = enabled;
	return action;
}

export function CreateContext(name: string, priority?: number, sink?: boolean, enabled?: boolean) {
	const context = new Instance("InputContext");
	context.Name = name;
	if (priority !== undefined) context.Priority = priority;
	if (sink !== undefined) context.Sink = sink;
	if (enabled !== undefined) context.Enabled = enabled;
	return context;
}

const warned = setmetatable(new Map<Instance, true>(), { __mode: "k" });

/**
 * In Studio, warns once about an instance the schema doesn't mention. Instances another live root
 * handle made (another schema on the same folder) are its own business: no warning.
 */
export function WarnUnmentioned(instance: Instance) {
	if (!RunService.IsStudio() || warned.has(instance) || IsPackageMade(instance)) return;
	warned.set(instance, true);
	warn(
		`InputActions: ${instance.GetFullName()} (${instance.ClassName}) is not in the schema: it is left alone, ` +
			"untyped, and IAS still runs it",
	);
}

/**
 * Waits until `parent` has a child named each of `names`, or the deadline (an `os.clock()` time)
 * passes. Returns the children found.
 */
export function WaitForChildren(
	parent: Instance,
	names: readonly string[],
	deadline: number,
): Map<string, Instance> {
	const found = new Map<string, Instance>();
	for (const name of names) {
		let child = parent.FindFirstChild(name);
		const remaining = deadline - os.clock();
		if (child === undefined && remaining > 0) child = parent.WaitForChild(name, remaining);
		if (child !== undefined) found.set(name, child);
	}
	return found;
}
