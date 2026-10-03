import { RunService } from "@rbxts/services";
import { DEVICES } from "./KeyGroups";
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

/** Suffix of the Scriptable binding `Fire` creates: `<Action>Script` */
export const SCRIPT_BINDING_SUFFIX = "Script";
/** Infix of the bindings `AttachButton` creates: `<Action>UIButton<n>` */
export const BUTTON_BINDING_INFIX = "UIButton";

/** Whether a binding under `action` was made by the package (Fire or AttachButton) */
export function IsPackageBindingName(actionName: string, bindingName: string): boolean {
	if (bindingName === actionName + SCRIPT_BINDING_SUFFIX) return true;
	return IsButtonBindingName(actionName, bindingName);
}

export function IsButtonBindingName(actionName: string, bindingName: string): boolean {
	const prefix = actionName + BUTTON_BINDING_INFIX;
	return (
		bindingName.sub(1, prefix.size()) === prefix &&
		bindingName.sub(prefix.size() + 1).match("^%d+$")[0] !== undefined
	);
}

/**
 * Why a slot can't have this name, if it can't: its binding (`S` or `A .. S`) would take the name
 * of a binding the package makes itself (`<Action>Script`, `<Action>UIButton<n>`).
 */
export function ReservedSlotProblem(actionName: string, slot: string): string | undefined {
	if (IsPackageBindingName("", slot) || IsPackageBindingName(actionName, slot)) {
		return (
			`the slot name "${slot}" is reserved: the package names its own bindings ` +
			`${actionName}${SCRIPT_BINDING_SUFFIX} (Fire) and ${actionName}${BUTTON_BINDING_INFIX}<n> (AttachButton)`
		);
	}
	return undefined;
}

/**
 * An action's binding names: the schema's, then the devices' it leaves out, since every action has
 * the three device bindings (0.7.0)
 */
export function WithDevices(slots: readonly string[]): string[] {
	const all = [...slots];
	for (const device of DEVICES) if (!all.includes(device)) all.push(device);
	return all;
}

/**
 * Why the schema's slots of one action can't have these names, if they can't: slots `S` and
 * `<Action>S` would both match the binding `<Action>S`. Every action also has the three device
 * bindings, so a slot named `<Action><Device>` collides with a device's the schema leaves out
 */
export function SlotCollision(actionName: string, slots: readonly string[]): string | undefined {
	if (actionName === "") return undefined;
	const all = WithDevices(slots);
	for (const slot of all) {
		const binding = actionName + slot;
		if (!all.includes(binding)) continue;
		// One of the two is a device's binding the schema leaves out: the other is the one to rename
		const device = !slots.includes(slot) ? slot : !slots.includes(binding) ? binding : undefined;
		if (device !== undefined) {
			const named = device === slot ? binding : slot;
			const every = "(every action has the three device bindings): rename it";
			return named === binding
				? `the name "${named}" is taken by the action's ${device} binding ${every}`
				: `the slot "${named}" would match the binding ${binding}, the action's ${device} binding ${every}`;
		}
		return `the slots "${slot}" and "${binding}" would both match the binding ${binding}: rename one`;
	}
	return undefined;
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
