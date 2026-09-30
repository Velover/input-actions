import { HttpService } from "@rbxts/services";
import { DecodeSavedEntry, SAVED_PROPERTIES } from "./BindingRules";
import { EncodeSavedValue, IBindingValues, ReadBinding, SameValues } from "./BindingState";
import { SCRIPTABLE } from "./Builders";
import type { BindingHandle } from "./Handles/BindingHandle";
import { IRuntime, JoinPath } from "./Internal";
import { IsKeyCode } from "./KeyGroups";
import type { IContextSchema, IImportResult, IInputSchema } from "./Types";

// Saved keybinds (design spec §7):
// { "Version": 1, "Bindings": { "Gameplay/Jump/KeyboardAndMouse": { "KeyCode": "F" } } }

export const BINDINGS_VERSION = 1;

/** JSONEncode writes an empty table as `[]`; the saved format always has an object */
function EncodeSave(bindings: Record<string, unknown>): string {
	for (const _ of pairs(bindings)) {
		return HttpService.JSONEncode({ Version: BINDINGS_VERSION, Bindings: bindings });
	}
	return `{"Version":${BINDINGS_VERSION},"Bindings":{}}`;
}

export function ExportBindings(handles: readonly BindingHandle[]): string {
	const bindings: Record<string, unknown> = {};
	for (const handle of handles) {
		const changes = handle.ExportChanges();
		if (changes !== undefined) bindings[handle.Path] = changes;
	}
	return EncodeSave(bindings);
}

/** Returns every binding to its defaults, reporting the ones that changed */
export function ResetBindings(runtime: IRuntime, handles: readonly BindingHandle[]) {
	if (runtime.IsDestroyed()) return;
	for (const handle of handles) {
		const before = ReadBinding(handle.Instance);
		handle.ResetQuietly();
		if (!SameValues(before, ReadBinding(handle.Instance)))
			runtime.NotifyBindingChanged(handle.Path);
	}
}

/** A save nests 4 deep at most: the save, `Bindings`, an entry, a vector */
const MAX_SAVE_DEPTH = 8;

/**
 * Whether `json` nests arrays or objects deeper than `limit`, outside strings. HttpService:JSONDecode
 * recurses into nesting, and a few hundred levels end the whole process, pcall or not (probed): a
 * save, which may come from a client, is measured before it is decoded.
 */
function NestsDeeperThan(json: string, limit: number): boolean {
	let depth = 0;
	let position = 1;
	while (true) {
		const [index] = json.find('[%[%]{}"]', position);
		if (index === undefined) return false;
		const character = json.sub(index, index);
		position = index + 1;
		if (character === '"') {
			// Skips the string: up to the next quote that isn't escaped
			while (true) {
				const [stop] = json.find('["\\]', position);
				// Unterminated: JSONDecode refuses it before reaching anything deeper
				if (stop === undefined) return false;
				const escape = json.sub(stop, stop) === "\\";
				position = stop + (escape ? 2 : 1);
				if (!escape) break;
			}
		} else if (character === "[" || character === "{") {
			depth++;
			if (depth > limit) return true;
		} else {
			depth--;
		}
	}
}

/** Decodes the outer object; returns the `Bindings` table, or the reason nothing can be applied */
function DecodeSave(json: string): Record<string, unknown> | string {
	if (!typeIs(json, "string")) return "the save is not a string";
	if (NestsDeeperThan(json, MAX_SAVE_DEPTH)) return "the save nests deeper than a save can";
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(json));
	if (!ok) return "the save is not valid JSON";
	if (!typeIs(decoded, "table")) return "the save is not an object";
	const save = decoded as { Version?: unknown; Bindings?: unknown };
	if (save.Version !== BINDINGS_VERSION) return `unknown Version ${tostring(save.Version)}`;
	if (!typeIs(save.Bindings, "table")) return "Bindings is not an object";
	return save.Bindings as Record<string, unknown>;
}

/**
 * Starts from the defaults, then applies each valid entry. Never throws: a bad save applies
 * nothing, and a bad entry is skipped (its binding stays at its default).
 * @param context when set, only paths of this context are applied
 */
export function ImportBindings(
	runtime: IRuntime,
	handles: readonly BindingHandle[],
	json: string,
	context?: string,
): IImportResult {
	const result: IImportResult = { Applied: [], Skipped: [] };
	if (runtime.IsDestroyed()) {
		result.Skipped.push({ Path: "", Reason: "the handle was destroyed" });
		return result;
	}
	const before = new Map<BindingHandle, IBindingValues>();
	const byPath = new Map<string, BindingHandle>();
	for (const handle of handles) {
		before.set(handle, ReadBinding(handle.Instance));
		byPath.set(handle.Path, handle);
		handle.ResetQuietly();
	}

	const bindings = DecodeSave(json);
	if (typeIs(bindings, "string")) {
		result.Skipped.push({ Path: "", Reason: bindings });
	} else {
		for (const [path, entry] of pairs(bindings)) {
			const skip = (reason: string) =>
				result.Skipped.push({ Path: tostring(path), Reason: reason });
			const handle = typeIs(path, "string") ? byPath.get(path) : undefined;
			if (handle === undefined) {
				const other =
					context !== undefined && typeIs(path, "string") && path.split("/")[0] !== context;
				skip(other ? `not a binding of ${context}` : "unknown path");
				continue;
			}
			const values = DecodeSavedEntry(handle.ActionType, entry, handle.GetDefaults().KeyCode);
			if (typeIs(values, "string")) {
				skip(values);
				continue;
			}
			handle.ApplySavedQuietly(values);
			result.Applied.push(handle.Path);
		}
	}

	for (const handle of handles) {
		if (!SameValues(before.get(handle)!, ReadBinding(handle.Instance)))
			runtime.NotifyBindingChanged(handle.Path);
	}
	result.Applied.sort();
	result.Skipped.sort((a, b) => a.Path < b.Path);
	return result;
}

/** The KeyCode a schema binding gives its instance: a bare key, or an object's `KeyCode` */
function SpecKeyCode(spec: unknown): Enum.KeyCode {
	if (IsKeyCode(spec)) return spec;
	const keyCode = typeIs(spec, "table") ? (spec as { KeyCode?: unknown }).KeyCode : undefined;
	return IsKeyCode(keyCode) ? keyCode : Enum.KeyCode.None;
}

/**
 * Runs the import validation against the schema alone (no instances; works on the server) and
 * returns a clean save with only the valid entries.
 */
export function SanitizeBindings(
	schema: IInputSchema<Record<string, IContextSchema>>,
	json: string,
): string {
	const clean: Record<string, unknown> = {};
	const bindings = DecodeSave(json);
	if (typeIs(bindings, "string")) return EncodeSave(clean);
	for (const [path, entry] of pairs(bindings)) {
		if (!typeIs(path, "string")) continue;
		const [contextName, actionName, slot, extra] = path.split("/");
		if (extra !== undefined || slot === undefined) continue;
		const action = schema.Contexts[contextName]?.Actions[actionName];
		const spec =
			action !== undefined ? (action.Bindings as Record<string, unknown>)[slot] : undefined;
		if (action === undefined || spec === undefined || spec === SCRIPTABLE) continue;
		const values = DecodeSavedEntry(action.Type.Name, entry, SpecKeyCode(spec));
		if (typeIs(values, "string")) continue;
		const cleanEntry: Record<string, unknown> = {};
		for (const name of SAVED_PROPERTIES) {
			const value = values.get(name);
			if (value !== undefined) cleanEntry[name] = EncodeSavedValue(value);
		}
		clean[path] = cleanEntry;
	}
	return EncodeSave(clean);
}
