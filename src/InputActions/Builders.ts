import {
	ActionTypeName,
	BINDING_PROPERTY_NAMES,
	BindingNameProblem,
	CheckBindingSpec,
	ExtraNameProblem,
	IsNamespace,
} from "./BindingRules";
import { Entries } from "./Internal";
import { Device, IsDevice } from "./KeyGroups";
import { ActionSlots, ReservedSlotProblem, SlotCollision } from "./Tree";
import type {
	BindingSpec,
	CheckBindings,
	CheckContexts,
	IActionDefinition,
	IActionOptions,
	IContextSchema,
	IInputSchema,
	IScriptable,
	ISchema,
} from "./Types";

/** The marker of a binding driven only from code (`Fire`) */
export const SCRIPTABLE = setmetatable(
	{},
	{ __tostring: () => "InputActions.Scriptable" },
) as unknown as IScriptable;

/** Members of the root handle: a context can't take one of these names */
export const ROOT_MEMBERS = [
	"BindingsChanged",
	"ExportBindings",
	"ImportBindings",
	"ResetBindings",
	"FindConflicts",
	"Destroy",
];

// ---- what `Schema` refuses, which `Create` checks again for a schema made without it

/** Whether a name has a "/", which would split a save's `Context/Action/Binding` paths */
function HasSlash(name: string) {
	return name.find("/", 1, true)[0] !== undefined;
}

/** Why a context can't have this name, if it can't */
export function ContextNameProblem(name: string): string | undefined {
	if (ROOT_MEMBERS.includes(name)) return "the name is taken by the root handle";
	if (HasSlash(name)) return `a context name can't contain "/"`;
	return undefined;
}

/** Why an action can't have this name, if it can't */
export function ActionNameProblem(name: string): string | undefined {
	return HasSlash(name) ? `an action name can't contain "/"` : undefined;
}

/**
 * Why a binding of action `actionName` declared as `spec` can't have the name `slot`, if it can't: a
 * "/", a name of the package's own bindings, or a name that doesn't fit the spec (keys under a
 * device's name, `InputActions.Scriptable` under any other). `SlotCollision` checks the slots together
 */
export function SlotNameProblem(
	actionName: string,
	slot: string,
	spec: unknown,
): string | undefined {
	if (HasSlash(slot)) return `a binding name can't contain "/"`;
	return ReservedSlotProblem(actionName, slot) ?? BindingNameProblem(slot, spec === SCRIPTABLE);
}

/** What is wrong in a device's binding: in its namespace, the extra it is about (undefined: `Main`) */
interface IDeviceBindingProblem {
	readonly Extra?: string;
	readonly Problem: string;
}

/**
 * Why a device's binding in a schema is wrong, if it is: a binding that breaks the rules, or a
 * namespace (`{ Main: <binding>, <Extra>: <binding> }`, 0.7.0) whose extra has a name it can't
 * take or whose binding breaks the rules. Each binding of a namespace takes the device's keys, or
 * `{}` (no keys); none is `InputActions.Scriptable`
 */
function DeviceBindingProblem(
	actionType: ActionTypeName,
	actionName: string,
	device: Device,
	spec: unknown,
): IDeviceBindingProblem | undefined {
	if (!IsNamespace(spec)) {
		const problem = CheckBindingSpec(actionType, spec, device);
		if (problem === undefined) return undefined;
		// A property no binding has: likely a second binding of the device, written beside the keys
		if (typeIs(spec, "table")) {
			for (const [name] of pairs(spec as Record<string, unknown>)) {
				if ((BINDING_PROPERTY_NAMES as readonly defined[]).includes(name)) continue;
				if (problem !== `${tostring(name)} is not a property of a ${actionType} binding`) continue;
				return {
					Problem:
						`${problem}; several bindings of one device go in ` +
						`{ Main: <binding>, ${tostring(name)}: <binding> }`,
				};
			}
		}
		return { Problem: problem };
	}
	for (const [name, binding] of pairs(spec)) {
		const extra = name === "Main" ? undefined : tostring(name);
		if (extra !== undefined) {
			const nameProblem =
				ExtraNameProblem(name) ?? ReservedSlotProblem(actionName, device + extra, extra);
			if (nameProblem !== undefined) return { Extra: extra, Problem: nameProblem };
		}
		if (binding === SCRIPTABLE) {
			return {
				Extra: extra,
				Problem:
					`a device's bindings hold keys, not InputActions.Scriptable: name a Scriptable ` +
					`binding beside the devices`,
			};
		}
		const problem = CheckBindingSpec(actionType, binding, device);
		if (problem !== undefined) return { Extra: extra, Problem: problem };
	}
	return undefined;
}

function DeepFreeze<T extends object>(value: T): T {
	if (table.isfrozen(value)) return value;
	for (const [, child] of pairs(value as Record<string, unknown>)) {
		if (typeIs(child, "table") && child !== SCRIPTABLE) DeepFreeze(child);
	}
	table.freeze(value);
	return value;
}

function Define(
	actionType: Enum.InputActionType,
	bindings: object | undefined,
	options: IActionOptions<boolean> | undefined,
): IActionDefinition<Enum.InputActionType, unknown, boolean> {
	return DeepFreeze({
		Type: actionType,
		Bindings: bindings ?? {},
		TrackPrevious: options?.TrackPrevious ?? false,
		DisplayName: options?.DisplayName,
		Enabled: options?.Enabled,
	});
}

export function Bool<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Bool>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, Enum.InputActionType.Bool>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Bool, B, TP> {
	return Define(Enum.InputActionType.Bool, bindings, options) as never;
}

export function Direction1D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction1D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, Enum.InputActionType.Direction1D>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction1D, B, TP> {
	return Define(Enum.InputActionType.Direction1D, bindings, options) as never;
}

export function Direction2D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction2D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, Enum.InputActionType.Direction2D>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction2D, B, TP> {
	return Define(Enum.InputActionType.Direction2D, bindings, options) as never;
}

export function Direction3D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction3D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, Enum.InputActionType.Direction3D>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction3D, B, TP> {
	return Define(Enum.InputActionType.Direction3D, bindings, options) as never;
}

export function ViewportPosition<
	const B extends Record<string, BindingSpec<Enum.InputActionType.ViewportPosition>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, Enum.InputActionType.ViewportPosition>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.ViewportPosition, B, TP> {
	return Define(Enum.InputActionType.ViewportPosition, bindings, options) as never;
}

const ACTION_TYPES = Enum.InputActionType.GetEnumItems();

/** The options of a context schema beside `Actions`, and the type of each */
const CONTEXT_OPTIONS: Record<string, "boolean" | "number"> = {
	ServerAuthority: "boolean",
	Priority: "number",
	Sink: "boolean",
	Enabled: "boolean",
};

/** The range of an InputContext's `Priority`, an int32: any other number lands on the lowest (probed) */
const MIN_PRIORITY = -2147483648;
const MAX_PRIORITY = 2147483647;

/** Whether an InputContext holds this `Priority` as it is: a whole number in int32 range (not NaN) */
function IsPriority(value: number): boolean {
	return value === math.floor(value) && value >= MIN_PRIORITY && value <= MAX_PRIORITY;
}

/**
 * Why a context schema's options are wrong, if they are: a misspelt one would be ignored, and a
 * `Priority` an InputContext can't hold (not an integer in int32 range: `math.huge`, NaN, `2 ** 31`
 * read as the lowest priority there is, 2.5 as 2) would put the context elsewhere without a word
 * (hunt HD4-5)
 */
function ContextOptionsProblem(context: object): string | undefined {
	for (const [key, value] of pairs(context as Record<string, unknown>)) {
		if (key === "Actions") continue;
		const expected = CONTEXT_OPTIONS[key as string];
		if (expected === undefined) {
			return (
				`unknown option "${tostring(key)}"; a context has ServerAuthority, Priority, Sink, ` +
				"Enabled and Actions"
			);
		}
		if (!typeIs(value, expected)) return `${key} must be a ${expected}, not ${typeOf(value)}`;
		if (key === "Priority" && !IsPriority(value as number)) {
			return (
				`Priority must be a whole number from ${MIN_PRIORITY} to ${MAX_PRIORITY}, not ` +
				tostring(value)
			);
		}
	}
	return undefined;
}

/** The options of an action definition, and the type of each */
const ACTION_OPTIONS: Record<string, "string" | "boolean"> = {
	DisplayName: "string",
	Enabled: "boolean",
	TrackPrevious: "boolean",
};

/**
 * Why an action definition's options are of the wrong type, if one is: a definition made without
 * the builders may hold anything there, and `DisplayName = {}` would throw in the middle of `Create`,
 * `Enabled = "no"` read as true (hunt HD4-4). Each may be left out
 */
function ActionOptionsProblem(action: object): string | undefined {
	const record = action as Record<string, unknown>;
	for (const [name, expected] of pairs(ACTION_OPTIONS)) {
		const value = record[name];
		if (value !== undefined && !typeIs(value, expected))
			return `${name} must be a ${expected}, not ${typeOf(value)}`;
	}
	return undefined;
}

/** What is wrong in a schema, and where: `Context`, `Context/Action` or `Context/Action/Binding` */
export interface ISchemaProblem {
	readonly Path: string;
	readonly Problem: string;
}

/**
 * The first thing `Schema` refuses in these contexts, if any: a name the handles can't hold, a
 * context without `Actions`, an option misspelt or of the wrong type, a `Priority` an InputContext
 * can't hold, something that isn't an action, an action option of the wrong type, a binding that
 * breaks the rules. `Create` runs it again, for a schema made without `Schema` (hunts HD2-5, HD3-2,
 * HD4-4, HD4-5)
 */
export function SchemaProblem(
	contexts: Readonly<Record<string, IContextSchema>>,
): ISchemaProblem | undefined {
	for (const [contextName, context] of Entries<IContextSchema>(contexts)) {
		const contextProblem = ContextNameProblem(contextName);
		if (contextProblem !== undefined) return { Path: contextName, Problem: contextProblem };
		if (!typeIs(context, "table") || !typeIs(context.Actions, "table"))
			return { Path: contextName, Problem: "missing Actions" };
		const optionsProblem = ContextOptionsProblem(context);
		if (optionsProblem !== undefined) return { Path: contextName, Problem: optionsProblem };
		for (const [actionName, action] of Entries(context.Actions)) {
			const actionPath = `${contextName}/${actionName}`;
			const actionProblem = ActionNameProblem(actionName);
			if (actionProblem !== undefined) return { Path: actionPath, Problem: actionProblem };
			if (!typeIs(action, "table") || !ACTION_TYPES.includes(action.Type)) {
				return {
					Path: actionPath,
					Problem: "not an action; use InputActions.Bool, Direction1D, ...",
				};
			}
			const optionProblem = ActionOptionsProblem(action);
			if (optionProblem !== undefined) return { Path: actionPath, Problem: optionProblem };
			const bindings = action.Bindings as Record<string, unknown>;
			for (const [slot, spec] of Entries(bindings)) {
				const slotPath = `${actionPath}/${slot}`;
				const nameProblem = SlotNameProblem(actionName, slot, spec);
				if (nameProblem !== undefined) return { Path: slotPath, Problem: nameProblem };
				if (spec === SCRIPTABLE || !IsDevice(slot)) continue;
				const found = DeviceBindingProblem(action.Type.Name, actionName, slot, spec);
				if (found === undefined) continue;
				// A namespace's Main is named so: its binding's path in a save ends with the device
				const where = found.Extra ?? (IsNamespace(spec) ? "Main" : undefined);
				return {
					Path: where !== undefined ? `${slotPath}/${where}` : slotPath,
					Problem: found.Problem,
				};
			}
			const collision = SlotCollision(actionName, ActionSlots(bindings));
			if (collision !== undefined) return { Path: actionPath, Problem: collision };
		}
	}
	return undefined;
}

/** Checks a schema at runtime (for values the types could not see, e.g. casts) and freezes it */
export function Schema<S extends Record<string, IContextSchema>>(
	contexts: S & CheckContexts<S>,
): ISchema<S> {
	const found = SchemaProblem(contexts);
	if (found !== undefined) error(`InputActions.Schema: ${found.Path}: ${found.Problem}`, 2);
	return DeepFreeze({ Contexts: contexts }) as IInputSchema<S> as ISchema<S>;
}
