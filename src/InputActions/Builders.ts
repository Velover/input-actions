import { CheckBindingSpec } from "./BindingRules";
import { Entries } from "./Internal";
import { ReservedSlotProblem } from "./Tree";
import type {
	BindingSpec,
	CheckBindings,
	IActionDefinition,
	IActionOptions,
	IBoolBinding,
	IContextSchema,
	IDirection1DCompositeBinding,
	IDirection1DKeyBinding,
	IDirection2DCompositeBinding,
	IDirection2DDeltaBinding,
	IDirection2DStickBinding,
	IDirection3DCompositeBinding,
	IInputSchema,
	IScriptable,
	IViewportPositionBinding,
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
	"Destroy",
];

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
	bindings?: B & CheckBindings<B, IBoolBinding>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Bool, B, TP> {
	return Define(Enum.InputActionType.Bool, bindings, options) as never;
}

export function Direction1D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction1D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, IDirection1DKeyBinding | IDirection1DCompositeBinding>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction1D, B, TP> {
	return Define(Enum.InputActionType.Direction1D, bindings, options) as never;
}

export function Direction2D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction2D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B &
		CheckBindings<
			B,
			IDirection2DStickBinding | IDirection2DDeltaBinding | IDirection2DCompositeBinding
		>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction2D, B, TP> {
	return Define(Enum.InputActionType.Direction2D, bindings, options) as never;
}

export function Direction3D<
	const B extends Record<string, BindingSpec<Enum.InputActionType.Direction3D>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, IDirection3DCompositeBinding>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.Direction3D, B, TP> {
	return Define(Enum.InputActionType.Direction3D, bindings, options) as never;
}

export function ViewportPosition<
	const B extends Record<string, BindingSpec<Enum.InputActionType.ViewportPosition>> = {},
	const TP extends boolean = false,
>(
	bindings?: B & CheckBindings<B, IViewportPositionBinding>,
	options?: IActionOptions<TP>,
): IActionDefinition<Enum.InputActionType.ViewportPosition, B, TP> {
	return Define(Enum.InputActionType.ViewportPosition, bindings, options) as never;
}

const ACTION_TYPES = Enum.InputActionType.GetEnumItems();

/** Checks a schema at runtime (for values the types could not see, e.g. casts) and freezes it */
export function Schema<S extends Record<string, IContextSchema>>(contexts: S): IInputSchema<S> {
	for (const [contextName, context] of Entries<IContextSchema>(contexts)) {
		const where = `InputActions.Schema: ${contextName}`;
		if (ROOT_MEMBERS.includes(contextName))
			error(`${where}: the name is taken by the root handle`, 2);
		if (contextName.find("/", 1, true)[0] !== undefined)
			error(`${where}: a context name can't contain "/"`, 2);
		if (!typeIs(context, "table") || !typeIs(context.Actions, "table"))
			error(`${where}: missing Actions`, 2);
		for (const [actionName, action] of Entries(context.Actions)) {
			const actionWhere = `${where}/${actionName}`;
			if (actionName.find("/", 1, true)[0] !== undefined)
				error(`${actionWhere}: an action name can't contain "/"`, 2);
			if (!typeIs(action, "table") || !ACTION_TYPES.includes(action.Type)) {
				error(`${actionWhere}: not an action; use InputActions.Bool, Direction1D, ...`, 2);
			}
			for (const [slot, spec] of Entries(action.Bindings as Record<string, unknown>)) {
				if (slot.find("/", 1, true)[0] !== undefined)
					error(`${actionWhere}/${slot}: a binding name can't contain "/"`, 2);
				const reserved = ReservedSlotProblem(actionName, slot);
				if (reserved !== undefined) error(`${actionWhere}/${slot}: ${reserved}`, 2);
				if (spec === SCRIPTABLE) continue;
				const problem = CheckBindingSpec(action.Type.Name, spec);
				if (problem !== undefined) error(`${actionWhere}/${slot}: ${problem}`, 2);
			}
		}
	}
	return DeepFreeze({ Contexts: contexts });
}
