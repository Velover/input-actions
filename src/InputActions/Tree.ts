import { RunService } from "@rbxts/services";
import { IsNamespace } from "./BindingRules";
import { DEVICES, Device, IsDevice } from "./KeyGroups";
import { IsPackageMade } from "./Registry";

// Name matching against an existing tree (design spec §4). A binding for slot `S` of action `A`
// matches a child InputBinding named `S` or `A .. S`: the Input Action Manager names its bindings
// `<Action><Device>`, e.g. `JumpKeyboardAndMouse`. A device's extra binding (0.7.0) is slot
// `<Device><Extra>`: `MoveKeyboardAndMouseArrows`.

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
 * of a binding the package makes itself (`<Action>Script`, `<Action>UIButton<n>`). A device's extra
 * is slot `<Device><Extra>`, named by `extra` in the message.
 */
export function ReservedSlotProblem(
	actionName: string,
	slot: string,
	extra?: string,
): string | undefined {
	if (IsPackageBindingName("", slot) || IsPackageBindingName(actionName, slot)) {
		const named =
			extra !== undefined
				? `the extra "${extra}" would be found as the binding ${slot}, which is reserved`
				: `the slot name "${slot}" is reserved`;
		return (
			`${named}: the package names its own bindings ` +
			`${actionName}${SCRIPT_BINDING_SUFFIX} (Fire) and ${actionName}${BUTTON_BINDING_INFIX}<n> (AttachButton)`
		);
	}
	return undefined;
}

/**
 * One binding of an action as the schema gives it: a device's main binding, a device's extra (0.7.0,
 * from `{ Main: <binding>, <Extra>: <binding> }`) or a Scriptable slot
 */
export interface ISlot {
	/**
	 * What its binding is found by (`S` or `<Action>S`) and named when made (`<Action>S`): the
	 * device, `<Device><Extra>` for an extra, or the Scriptable slot's name
	 */
	readonly Name: string;
	/** The device of a binding with keys, main or extra; undefined for a Scriptable slot */
	readonly Device?: Device;
	/** An extra's name in its device's namespace */
	readonly Extra?: string;
	/** The schema's binding; undefined for a device the schema leaves out (made unbound) */
	readonly Spec: unknown;
}

/**
 * Every binding of an action: the schema's (a device's main binding before its extras), then the
 * devices' it leaves out, since every action has the three device bindings (0.7.0). Assumes names
 * `Schema` takes (`SchemaProblem` checks them first)
 */
export function ActionSlots(bindings: Readonly<Record<string, unknown>>): ISlot[] {
	const slots = new Array<ISlot>();
	for (const [name, spec] of pairs(bindings)) {
		const slot = name as string;
		if (!IsDevice(slot)) slots.push({ Name: slot, Spec: spec });
		else if (!IsNamespace(spec)) slots.push({ Name: slot, Device: slot, Spec: spec });
		else {
			slots.push({ Name: slot, Device: slot, Spec: spec.Main });
			for (const [extra, extraSpec] of pairs(spec)) {
				if (extra === "Main") continue;
				const extraName = tostring(extra);
				slots.push({ Name: slot + extraName, Device: slot, Extra: extraName, Spec: extraSpec });
			}
		}
	}
	for (const device of DEVICES) {
		if (bindings[device] === undefined) slots.push({ Name: device, Device: device, Spec: undefined });
	}
	return slots;
}

/** A slot as messages name it: a device's extra by its device and name, any other by its name */
function SlotLabel(slot: ISlot): string {
	return slot.Extra !== undefined ? `the ${slot.Device} extra "${slot.Extra}"` : `"${slot.Name}"`;
}

/**
 * Why an action's bindings can't have these names, if they can't: slots `S` and `<Action>S` would
 * both match the binding `<Action>S`. Every action also has the three device bindings, so a slot
 * named `<Action><Device>` collides with a device's the schema leaves out. A device's extra is found
 * as `<Device><Extra>` (or `<Action><Device><Extra>`), so a Scriptable slot of that name is its
 * binding too
 */
export function SlotCollision(actionName: string, slots: readonly ISlot[]): string | undefined {
	for (let index = 0; index < slots.size(); index++) {
		const slot = slots[index];
		for (let other = index + 1; other < slots.size(); other++) {
			const twin = slots[other];
			if (twin.Name !== slot.Name) continue;
			return (
				`${SlotLabel(slot)} and ${SlotLabel(twin)} would both be the binding ` +
				`${actionName}${slot.Name}: rename one`
			);
		}
	}
	if (actionName === "") return undefined;
	for (const slot of slots) {
		const binding = actionName + slot.Name;
		const match = slots.find((other) => other.Name === binding);
		if (match === undefined) continue;
		const every = "(every action has the three device bindings): rename it";
		// One of the two is a device's binding the schema leaves out: the other is the one to rename
		if (slot.Spec === undefined) {
			return match.Extra === undefined
				? `the name "${binding}" is taken by the action's ${slot.Device} binding ${every}`
				: `${SlotLabel(match)} would be found as the binding ${binding}, the action's ${slot.Device} binding ${every}`;
		}
		if (match.Spec === undefined) {
			return `the slot "${slot.Name}" would match the binding ${binding}, the action's ${match.Device} binding ${every}`;
		}
		if (slot.Extra === undefined && match.Extra === undefined)
			return `the slots "${slot.Name}" and "${binding}" would both match the binding ${binding}: rename one`;
		return `${SlotLabel(slot)} and ${SlotLabel(match)} would both match the binding ${binding}: rename one`;
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
