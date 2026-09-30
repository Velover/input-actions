import {
	GuiService,
	HttpService,
	Players,
	ReplicatedStorage,
	RunService,
	UserInputService,
} from "@rbxts/services";
import { EveryFrame } from "../Internal/EveryFrame";
import { CheckBindingKeys } from "./BindingRules";
import { ApplySpec, ReadBinding, WriteBinding } from "./BindingState";
import { ExportBindings, ImportBindings, ResetBindings } from "./BindingsJson";
import { ROOT_MEMBERS, SCRIPTABLE } from "./Builders";
import { ActionHandle, IMovedBindings, MoveBindings, RefireHeldValues } from "./Handles/ActionHandle";
import { BindingHandle, ScriptableBindingHandle } from "./Handles/BindingHandle";
import { ContextHandle, ContextState } from "./Handles/ContextHandle";
import { Entries, IRuntime, JoinPath, NEUTRAL_VALUES, ReleaseOnServer } from "./Internal";
import {
	AddUser,
	GetEntry,
	ISharedEntry,
	IsPackageMade,
	IsShared,
	RemoveUser,
} from "./Registry";
import {
	CheckPlayerFolderName,
	CreateAction,
	CreateContext,
	DEFAULT_PLAYER_FOLDER_NAME,
	DEFAULT_TIMEOUT,
	FindAction,
	FindBinding,
	FindContext,
	IsPackageBindingName,
	MatchesSlot,
	ReservedSlotProblem,
	SlotCollision,
	WarnUnmentioned,
} from "./Tree";
import type {
	IActionDefinition,
	IContextSchema,
	ICreateOptions,
	IImportResult,
	IInputSchema,
	InputHandle,
} from "./Types";

type AnyDefinition = IActionDefinition<Enum.InputActionType, unknown, boolean>;

/**
 * The local stand-in of a Server Authority context whose copy has not arrived (§8). Every root
 * handle waiting for the same copy shares it, as it would share the copy: one context, one enabled
 * state, and one swap for all of them.
 */
interface IStandIn {
	/** `<PlayerFolderName>/<Context>`: where the copy is expected */
	Key: string;
	Name: string;
	Instance: InputContext;
	/** Each root handle's context on it, until the swap */
	Links: IPendingLink[];
}

/** One root handle's context running on a stand-in until the server's copy arrives */
interface IPendingLink {
	Runtime: InputRuntime;
	Schema: IContextSchema;
	Handle: ContextHandle;
	StandIn: IStandIn;
}

/** The stand-ins waiting for their copy, by key */
const standIns = new Map<string, IStandIn>();
/** The client-only folder of the stand-ins, shared by the root handles; the server never sees it */
let standInFolder: Folder | undefined;

/** The default folder: `ReplicatedStorage.Inputs`, the one the Input Action Manager writes */
export function GetDefaultFolder(): Instance {
	const existing = ReplicatedStorage.FindFirstChild("Inputs");
	if (existing !== undefined) return existing;
	const folder = new Instance("Folder");
	folder.Name = "Inputs";
	folder.Parent = ReplicatedStorage;
	return folder;
}

/** Whether `context` has every action of the schema (the server's copy may still be arriving) */
function HasActions(context: Instance, schema: IContextSchema) {
	for (const [actionName] of Entries(schema.Actions)) {
		const action = context.FindFirstChild(actionName);
		if (action === undefined || !action.IsA("InputAction")) return false;
	}
	return true;
}

/** Whether `copy` is a server's copy with every action each root handle on the stand-in needs */
function IsCopyReady(standIn: IStandIn, copy: Instance | undefined): copy is InputContext {
	if (copy === undefined || !copy.IsA("InputContext")) return false;
	return standIn.Links.every((link) => HasActions(copy, link.Schema));
}

/** The template's action of that name, when it has one */
function TemplateAction(template: InputContext | undefined, name: string): InputAction | undefined {
	const action = template?.FindFirstChild(name);
	return action !== undefined && action.IsA("InputAction") ? action : undefined;
}

/**
 * Everything behind one root handle. The root handle `Create` returns is a separate table (`Root`):
 * the contexts by name beside the public members, so no context name can shadow what the runtime
 * uses internally.
 */
export class InputRuntime implements IRuntime {
	readonly BindingsChanged: RBXScriptSignal<(path: string) => void>;
	readonly Root: Record<string, unknown>;

	private readonly _bindingsChanged = new Instance("BindableEvent");
	private readonly _contexts = new Array<ContextHandle>();
	private readonly _bindings = new Array<BindingHandle>();
	private readonly _tracked = new Array<ActionHandle>();
	/** The instances the handles use, in order; each is one use in the shared registry */
	private readonly _uses = new Array<Instance>();
	private readonly _used = new Set<Instance>();
	private readonly _connections = new Set<RBXScriptConnection>();
	private readonly _pendingLinks = new Array<IPendingLink>();
	/** Actions of a server's copy the schema doesn't mention, which the package gave the template's bindings */
	private readonly _extraActions = new Array<InputAction>();
	private _standInFolder?: Folder;
	private _stopSnapshots?: () => void;
	private _focusReleases?: Array<() => void>;
	private _destroyed = false;

	constructor() {
		this.BindingsChanged = this._bindingsChanged.Event as RBXScriptSignal<(path: string) => void>;
		const runtime = this;
		this.Root = {
			BindingsChanged: this.BindingsChanged,
			ExportBindings() {
				return runtime.ExportBindings();
			},
			ImportBindings(json: string) {
				return runtime.ImportBindings(json);
			},
			ResetBindings() {
				runtime.ResetBindings();
			},
			Destroy() {
				runtime.Destroy();
			},
		};
	}

	// ---- IRuntime

	NotifyBindingChanged(path: string) {
		if (!this._destroyed) this._bindingsChanged.Fire(path);
	}

	TrackCreated(instance: Instance) {
		this.AddUse(instance, true);
	}

	Use(instance: Instance) {
		this.AddUse(instance, false);
	}

	Untrack(instance: Instance) {
		this.DropUse(instance);
	}

	TrackConnection(connection: RBXScriptConnection) {
		this._connections.add(connection);
	}

	UntrackConnection(connection: RBXScriptConnection) {
		this._connections.delete(connection);
	}

	IsDestroyed() {
		return this._destroyed;
	}

	// ---- public

	ExportBindings(): string {
		return ExportBindings(this._bindings);
	}

	ImportBindings(json: string): IImportResult {
		return ImportBindings(this, this._bindings, json);
	}

	ResetBindings() {
		ResetBindings(this, this._bindings);
	}

	/**
	 * Disconnects everything and ends the handles' requests. What no other root handle uses is let
	 * go of: actions are released first, instances the package made are destroyed, adopted bindings
	 * get their defaults back and templates their `Enabled`.
	 */
	Destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		this._stopSnapshots?.();
		for (const connection of this._connections) connection.Disconnect();
		this._connections.clear();
		// Its contexts leave the stand-ins they share; a stand-in no one waits on is off the list
		for (const link of this._pendingLinks) {
			const standIn = link.StandIn;
			const index = standIn.Links.indexOf(link);
			if (index !== -1) standIn.Links.remove(index);
			if (standIn.Links.size() === 0 && standIns.get(standIn.Key) === standIn)
				standIns.delete(standIn.Key);
		}
		this._pendingLinks.clear();

		// Released while their bindings still exist: a held binding that is destroyed leaves its
		// action stuck on (probed)
		const actions = new Array<ActionHandle>();
		const owned = new Array<ActionHandle>();
		for (const context of this._contexts) {
			for (const [, action] of pairs(context.Actions)) {
				actions.push(action);
				// Another root handle still uses it: only what this one holds is let go
				if (IsShared(action.Instance)) {
					action.ReleaseOwn();
					continue;
				}
				owned.push(action);
				action.Release();
			}
		}
		// The template's bindings the package gave them go with their last user
		for (const action of this._extraActions) {
			if (!IsShared(action)) ReleaseOnServer(action);
		}
		for (const context of this._contexts) context.Destroy();
		for (let index = this._uses.size() - 1; index >= 0; index--) {
			const instance = this._uses[index];
			const entry = RemoveUser(instance);
			if (entry === undefined) continue;
			if (entry.Created) instance.Destroy();
			else if (entry.TemplateEnabled !== undefined) {
				if (instance.Parent !== undefined) (instance as InputContext).Enabled = entry.TemplateEnabled;
			} else if (entry.Defaults !== undefined) WriteBinding(instance as InputBinding, entry.Defaults);
		}
		this._uses.clear();
		this._used.clear();
		for (const action of owned) {
			// A button binding destroyed above while pressed: IAS resets a disabled action
			const instance = action.Instance;
			if (instance.Parent !== undefined && instance.Enabled && action.IsPressed()) {
				instance.Enabled = false;
				instance.Enabled = true;
			}
		}
		for (const action of actions) action.Destroy();
		this._bindingsChanged.Destroy();
	}

	// ---- building

	Build(contexts: Record<string, IContextSchema>, options: ICreateOptions) {
		const folder = options.Folder ?? GetDefaultFolder();
		const playerFolderName = options.PlayerFolderName ?? DEFAULT_PLAYER_FOLDER_NAME;
		CheckPlayerFolderName(playerFolderName);

		for (const [name, schema] of pairs(contexts)) {
			// Schema refuses these names; a schema made without it could still hold one
			if (ROOT_MEMBERS.includes(name as string))
				error(`InputActions.Create: ${name}: the name is taken by the root handle`, 0);
			if (schema.ServerAuthority === true) {
				this.BuildServerAuthorityContext(name, schema, folder, playerFolderName);
			} else {
				this.BuildContext(name, schema, folder);
			}
		}
		for (const child of folder.GetChildren()) {
			if (child.IsA("InputContext") && contexts[child.Name] === undefined) WarnUnmentioned(child);
		}

		if (this._pendingLinks.size() > 0) {
			this.WatchForServerCopies(playerFolderName, options.Timeout ?? DEFAULT_TIMEOUT);
		}
		if (this._tracked.size() > 0) this.StartSnapshots();
		if (options.ResetOnFocusLoss !== false) this.ResetOnFocusLoss();
	}

	/** Drops this runtime's use of the instance; with `destroyUnused`, what the package made goes with its last user */
	private DropUse(instance: Instance, destroyUnused = false) {
		if (!this._used.has(instance)) return;
		this._used.delete(instance);
		const index = this._uses.indexOf(instance);
		if (index !== -1) this._uses.remove(index);
		const entry = RemoveUser(instance);
		if (destroyUnused && entry?.Created) instance.Destroy();
	}

	/** Registers one use of the instance by this runtime (once per instance) */
	private AddUse(instance: Instance, created: boolean): ISharedEntry {
		if (this._used.has(instance)) {
			const entry = GetEntry(instance)!;
			if (created) entry.Created = true;
			return entry;
		}
		this._used.add(instance);
		this._uses.push(instance);
		return AddUser(instance, created);
	}

	/** The enabled state of a context, shared with every other root handle on it */
	private GetContextState(context: InputContext): ContextState {
		const entry = this.AddUse(context, false);
		entry.Context ??= new ContextState(context);
		return entry.Context;
	}

	/** Registered before its actions are built: a throw on the way must still end the handle */
	private AddContext(handle: ContextHandle) {
		this._contexts.push(handle);
		this.Root[handle.Name] = handle;
	}

	private BuildContext(name: string, schema: IContextSchema, folder: Instance) {
		let context = FindContext(folder, name, name);
		const created = context === undefined;
		if (context === undefined) {
			context = CreateContext(name, schema.Priority, schema.Sink, schema.Enabled);
			this.TrackCreated(context);
		}
		const handle = new ContextHandle(this, this.GetContextState(context), name);
		this.AddContext(handle);
		for (const [actionName, definition] of Entries(schema.Actions)) {
			this.BuildAction(handle, context, actionName, definition, undefined, !created);
		}
		if (created) {
			context.Parent = folder;
		} else {
			for (const child of context.GetChildren()) {
				if (child.IsA("InputAction") && schema.Actions[child.Name] === undefined)
					WarnUnmentioned(child);
			}
		}
	}

	/**
	 * `Create` never waits for the server. When the server's copy under the player is already
	 * there, the bindings are added to it, locally: from the template in the folder when it has
	 * them, else from the schema. Otherwise the context runs on a local stand-in until the copy
	 * arrives (`LinkStandIn`): the stand-in another root handle waits on for the same copy, or a
	 * new one (a clone of the template, or built from the schema).
	 */
	private BuildServerAuthorityContext(
		name: string,
		schema: IContextSchema,
		folder: Instance,
		playerFolderName: string,
	) {
		const template = FindContext(folder, name, name);
		let templateEnabled = true;
		if (template !== undefined) {
			// Disabled locally while any root handle uses it: it would otherwise process the same
			// keys beside the stand-in or the player's copy
			const entry = this.AddUse(template, false);
			if (entry.TemplateEnabled === undefined) {
				entry.TemplateEnabled = template.Enabled;
				template.Enabled = false;
			}
			templateEnabled = entry.TemplateEnabled;
			this.WarnTemplateExtras(template, schema);
		}

		const key = `${playerFolderName}/${name}`;
		const copy = Players.LocalPlayer.FindFirstChild(playerFolderName)?.FindFirstChild(name);
		// Root handles waiting on a stand-in swap first, so the copy carries their state
		const waiting = standIns.get(key);
		if (waiting !== undefined && IsCopyReady(waiting, copy)) InputRuntime.LinkStandIn(waiting, copy);
		if (copy !== undefined && copy.IsA("InputContext") && HasActions(copy, schema)) {
			const handle = new ContextHandle(this, this.GetContextState(copy), name, true);
			this.AddContext(handle);
			for (const [actionName, definition] of Entries(schema.Actions)) {
				const templateAction = TemplateAction(template, actionName);
				this.BuildAction(handle, copy, actionName, definition, templateAction, false);
			}
			this.CloneExtraBindings(copy, template, schema);
			return;
		}

		let standIn = standIns.get(key);
		let handle: ContextHandle;
		if (standIn !== undefined) {
			// Adopted as any context in a folder; the template fills what the stand-in lacks
			const instance = standIn.Instance;
			this.UseStandInFolder();
			handle = new ContextHandle(this, this.GetContextState(instance), name);
			this.AddContext(handle);
			for (const [actionName, definition] of Entries(schema.Actions)) {
				const templateAction = TemplateAction(template, actionName);
				this.BuildAction(handle, instance, actionName, definition, templateAction, false);
			}
			this.CloneExtraBindings(instance, template, schema);
		} else {
			let instance: InputContext;
			if (template !== undefined) {
				instance = template.Clone();
				instance.Enabled = templateEnabled;
			} else {
				instance = CreateContext(name, schema.Priority, schema.Sink, schema.Enabled);
			}
			// Everything in the stand-in is the package's, including what was cloned with the template
			this.TrackCreated(instance);
			for (const descendant of instance.GetDescendants()) this.TrackCreated(descendant);
			handle = new ContextHandle(this, this.GetContextState(instance), name);
			this.AddContext(handle);
			for (const [actionName, definition] of Entries(schema.Actions)) {
				this.BuildAction(handle, instance, actionName, definition, undefined, false);
			}
			instance.Parent = this.UseStandInFolder();
			standIn = { Key: key, Name: name, Instance: instance, Links: [] };
			standIns.set(key, standIn);
		}
		const link: IPendingLink = { Runtime: this, Schema: schema, Handle: handle, StandIn: standIn };
		standIn.Links.push(link);
		this._pendingLinks.push(link);
	}

	/** In Studio, warns about what the template has and the schema doesn't mention */
	private WarnTemplateExtras(template: InputContext, schema: IContextSchema) {
		for (const child of template.GetChildren()) {
			if (!child.IsA("InputAction")) continue;
			const definition = schema.Actions[child.Name];
			if (definition === undefined) {
				WarnUnmentioned(child);
				continue;
			}
			const slots = Entries(definition.Bindings as Record<string, unknown>).map(([slot]) => slot);
			for (const binding of child.GetChildren()) {
				if (binding.IsA("InputBinding") && !MatchesSlot(child.Name, binding.Name, slots)) {
					WarnUnmentioned(binding);
				}
			}
		}
	}

	/** Gives the copy's actions the schema doesn't mention the template's bindings, as IAS would run them */
	private CloneExtraBindings(
		copy: InputContext,
		template: InputContext | undefined,
		schema: IContextSchema,
	) {
		if (template === undefined) return;
		for (const action of copy.GetChildren()) {
			if (!action.IsA("InputAction") || schema.Actions[action.Name] !== undefined) continue;
			const templateAction = template.FindFirstChild(action.Name);
			if (templateAction === undefined) continue;
			this.UseExtraAction(action);
			for (const binding of templateAction.GetChildren()) {
				if (binding.IsA("InputBinding")) this.CloneOrAdopt(binding, action);
			}
		}
	}

	/** An action of the server's copy the schema doesn't mention, given the template's bindings */
	private UseExtraAction(action: InputAction) {
		if (this._used.has(action)) return;
		this.Use(action);
		this._extraActions.push(action);
	}

	/** Clones a template binding under `action`, or adopts the clone another root handle made */
	private CloneOrAdopt(binding: InputBinding, action: InputAction) {
		const existing = action.FindFirstChild(binding.Name);
		if (existing === undefined) this.CloneBinding(binding, action);
		else if (IsPackageMade(existing)) this.Use(existing);
	}

	/** The client-only folder of the stand-ins, shared by the root handles that have one */
	private UseStandInFolder(): Folder {
		if (this._standInFolder !== undefined) return this._standInFolder;
		let folder = standInFolder;
		if (folder !== undefined && IsPackageMade(folder)) {
			this.Use(folder);
		} else {
			folder = new Instance("Folder");
			folder.Name = "InputActionsStandIns";
			folder.Parent = ReplicatedStorage;
			this.TrackCreated(folder);
			standInFolder = folder;
		}
		this._standInFolder = folder;
		return folder;
	}

	/** Lets go of the stand-in folder once none of this root handle's stand-ins is left in it */
	private DropStandInFolder() {
		const folder = this._standInFolder;
		if (folder === undefined) return;
		// A stand-in kept for a copy of another Type
		for (const child of folder.GetChildren()) {
			if (this._used.has(child)) return;
		}
		this._standInFolder = undefined;
		this.DropUse(folder, true);
	}

	/** Swaps each stand-in for the server's copy once it arrives; warns once after `timeout` */
	private WatchForServerCopies(playerFolderName: string, timeout: number) {
		const connection = RunService.Heartbeat.Connect(() => {
			const folder = Players.LocalPlayer.FindFirstChild(playerFolderName);
			for (const pending of [...this._pendingLinks]) {
				// Swapped already, with another root handle on the same stand-in
				if (folder === undefined || !this._pendingLinks.includes(pending)) continue;
				const copy = folder.FindFirstChild(pending.StandIn.Name);
				if (IsCopyReady(pending.StandIn, copy)) InputRuntime.LinkStandIn(pending.StandIn, copy);
			}
			if (this._pendingLinks.size() === 0) {
				connection.Disconnect();
				this.UntrackConnection(connection);
				this.DropStandInFolder();
			}
		});
		this.TrackConnection(connection);

		task.delay(timeout, () => {
			if (this._destroyed || this._pendingLinks.size() === 0) return;
			const names = this._pendingLinks.map((pending) => pending.StandIn.Name);
			names.sort();
			// A copy that is there but lacks actions: the server runs another version of the schema
			const incomplete = new Array<string>();
			const folder = Players.LocalPlayer.FindFirstChild(playerFolderName);
			for (const pending of this._pendingLinks) {
				const copy = folder?.FindFirstChild(pending.StandIn.Name);
				if (copy === undefined) continue;
				const missing = new Array<string>();
				for (const link of pending.StandIn.Links) {
					for (const [actionName] of Entries(link.Schema.Actions)) {
						const action = copy.FindFirstChild(actionName);
						if ((action === undefined || !action.IsA("InputAction")) && !missing.includes(actionName))
							missing.push(actionName);
					}
				}
				missing.sort();
				incomplete.push(`${pending.StandIn.Name} is there but lacks ${missing.join(", ")}`);
			}
			incomplete.sort();
			warn(
				`InputActions.Create: after ${timeout} s the server's copy of ${names.join(", ")} has not ` +
					`arrived under ${Players.LocalPlayer.Name}.${playerFolderName}. Until it does, these ` +
					"contexts run on a local stand-in whose state never reaches the server. Is " +
					"InputActions.ProvideToPlayers called on the server, with the same PlayerFolderName " +
					`("${playerFolderName}")?` +
					(incomplete.size() > 0
						? ` (${incomplete.join("; ")}: does the server use the same schema?)`
						: ""),
			);
		});
	}

	/**
	 * Swaps a stand-in for the server's copy, for every root handle on it at once. The bindings
	 * move under the server's actions with everything they have (rebinds, attached buttons), the
	 * handles point at the copy, the context's state (base state and every handle's requests) goes
	 * with them, the stand-in is destroyed, then the values the Scriptable bindings held are fired
	 * again. Defaults don't change, so `Reset` still returns to the same ones. A copy whose actions
	 * are of another Type leaves the handles on the stand-in.
	 */
	private static LinkStandIn(standIn: IStandIn, copy: InputContext) {
		const links = [...standIn.Links];
		standIns.delete(standIn.Key);
		standIn.Links.clear();
		for (const link of links) {
			const pending = link.Runtime._pendingLinks;
			const index = pending.indexOf(link);
			if (index !== -1) pending.remove(index);
		}
		for (const link of links) {
			for (const [actionName, definition] of Entries(link.Schema.Actions)) {
				const action = copy.FindFirstChild(actionName) as InputAction;
				if (action.Type === definition.Type) continue;
				warn(
					`InputActions: ${JoinPath(standIn.Name, actionName)}: the server's copy is a ${action.Type.Name} ` +
						`action, but the schema declares ${definition.Type.Name}; staying on the local stand-in`,
				);
				return;
			}
		}

		// Every action of the stand-in moves its bindings once, a template's extras included
		const source = standIn.Instance;
		const moves = new Map<InputAction, IMovedBindings>();
		for (const action of source.GetChildren()) {
			if (!action.IsA("InputAction")) continue;
			const target = copy.FindFirstChild(action.Name);
			if (target === undefined || !target.IsA("InputAction")) continue;
			const mentioned = links.some((link) => link.Schema.Actions[action.Name] !== undefined);
			moves.set(action, MoveBindings(action, target, mentioned));
		}
		for (const link of links) {
			const runtime = link.Runtime;
			for (const [, handle] of pairs(link.Handle.Actions)) {
				const moved = moves.get(handle.Instance)!;
				runtime.Use(moved.Target);
				handle.LinkTo(moved.Target, moved.Moved);
			}
			for (const [action, moved] of moves) {
				for (const [binding, now] of moved.Moved) {
					if (now !== binding && runtime._used.has(binding)) runtime.Use(now);
				}
				if (link.Schema.Actions[action.Name] === undefined && runtime._used.has(action))
					runtime.UseExtraAction(moved.Target);
			}
			runtime.AddUse(copy, false);
		}

		const state = links[0].Handle.GetSharedState();
		const entry = GetEntry(copy)!;
		if (entry.Context === undefined) {
			entry.Context = state;
			state.MoveTo(copy);
		} else {
			for (const handle of [...state.Handles]) handle.JoinState(entry.Context);
		}
		source.Enabled = false;
		source.Destroy();
		for (const link of links) link.Runtime.DropUse(source);
		for (const [, moved] of moves) RefireHeldValues(moved);
		for (const link of links) link.Handle.MarkLinked();
	}

	private CloneBinding(binding: InputBinding, action: InputAction): InputBinding {
		const clone = binding.Clone();
		clone.Parent = action;
		this.TrackCreated(clone);
		return clone;
	}

	private BuildAction(
		contextHandle: ContextHandle,
		context: InputContext,
		actionName: string,
		definition: AnyDefinition,
		templateAction: InputAction | undefined,
		warnExtras: boolean,
	) {
		const path = JoinPath(contextHandle.Name, actionName);
		// Schema refuses these; a schema made without it could still hold them
		const slots = Entries(definition.Bindings as Record<string, unknown>).map(([slot]) => slot);
		const collision = SlotCollision(actionName, slots);
		if (collision !== undefined) error(`InputActions.Create: ${path}: ${collision}`, 0);
		let action = FindAction(context, actionName, definition.Type, path);
		const created = action === undefined;
		if (action === undefined) {
			action = CreateAction(
				actionName,
				definition.Type,
				definition.DisplayName,
				definition.Enabled,
			);
			action.Parent = context;
			this.TrackCreated(action);
		} else {
			this.Use(action);
		}

		const handle = new ActionHandle(this, action, actionName, definition.TrackPrevious);
		for (const [slot, spec] of pairs(definition.Bindings as Record<string, unknown>)) {
			handle.Bindings[slot] = this.BuildBinding(
				contextHandle,
				action,
				actionName,
				slot,
				spec,
				templateAction,
			);
		}

		// Template bindings that fill no slot run beside the package's own ones, as in the template
		if (templateAction !== undefined) {
			for (const binding of templateAction.GetChildren()) {
				if (!binding.IsA("InputBinding") || MatchesSlot(actionName, binding.Name, slots)) continue;
				this.CloneOrAdopt(binding, action);
			}
		}
		if (warnExtras && !created) {
			for (const binding of action.GetChildren()) {
				if (!binding.IsA("InputBinding") || MatchesSlot(actionName, binding.Name, slots)) continue;
				if (!IsPackageBindingName(actionName, binding.Name)) WarnUnmentioned(binding);
			}
		}

		contextHandle.Actions[actionName] = handle;
		if (handle.IsTracked()) this._tracked.push(handle);
	}

	private BuildBinding(
		contextHandle: ContextHandle,
		action: InputAction,
		actionName: string,
		slot: string,
		spec: unknown,
		templateAction: InputAction | undefined,
	): BindingHandle | ScriptableBindingHandle {
		const path = JoinPath(contextHandle.Name, actionName, slot);
		// Schema refuses these names; a schema made without it could still hold one
		const reserved = ReservedSlotProblem(actionName, slot);
		if (reserved !== undefined) error(`InputActions.Create: ${path}: ${reserved}`, 0);
		const scriptable = spec === SCRIPTABLE;
		let binding = FindBinding(action, actionName, slot);
		// Found: the designer's, or one another root handle on this folder made
		if (binding !== undefined) this.Use(binding);
		else if (templateAction !== undefined) {
			const template = FindBinding(templateAction, actionName, slot);
			if (template !== undefined) binding = this.CloneBinding(template, action);
		}

		if (binding === undefined) {
			binding = new Instance("InputBinding");
			binding.Name = actionName + slot;
			if (scriptable) binding.Type = Enum.InputBindingType.Scriptable;
			else ApplySpec(binding, spec);
			binding.Parent = action;
			this.TrackCreated(binding);
		} else if (scriptable !== (binding.Type === Enum.InputBindingType.Scriptable)) {
			warn(
				`InputActions: ${path}: ${binding.GetFullName()} is ${binding.Type.Name}, but the schema declares ` +
					`${scriptable ? "InputActions.Scriptable" : "a key binding"}; left as it is`,
			);
		} else if (!scriptable) {
			const problem = CheckBindingKeys(action.Type.Name, binding);
			if (problem !== undefined)
				warn(`InputActions: ${path}: ${binding.GetFullName()}: ${problem}; left as it is`);
		}

		if (scriptable) {
			return new ScriptableBindingHandle(this, binding, slot, NEUTRAL_VALUES[action.Type.Name]);
		}
		// Every root handle on this binding shares the defaults the first one took
		const entry = GetEntry(binding)!;
		entry.Defaults ??= ReadBinding(binding);
		const handle = new BindingHandle(this, binding, path, action.Type.Name, slot, entry.Defaults);
		this._bindings.push(handle);
		contextHandle.BindingHandles.push(handle);
		return handle;
	}

	/** One snapshot per frame for TrackPrevious actions, after input is processed */
	private StartSnapshots() {
		this._stopSnapshots = EveryFrame(
			() => {
				for (const action of this._tracked) action.Snapshot();
			},
			`InputActionsSnapshot_${HttpService.GenerateGUID(false)}`,
			Enum.RenderPriority.First.Value,
		);
	}

	/**
	 * Keys whose release is swallowed (TextBox focus, window focus loss, menu) could stay stuck:
	 * every context is held disabled for one frame, which makes IAS release them.
	 */
	private ResetOnFocusLoss() {
		const Hold = () => {
			if (this._focusReleases !== undefined || this._destroyed) return;
			const releases = this._contexts.map((context) => context.Request(false));
			this._focusReleases = releases;
			task.spawn(() => {
				RunService.Heartbeat.Wait();
				this._focusReleases = undefined;
				for (const release of releases) release();
			});
		};
		this.TrackConnection(UserInputService.TextBoxFocused.Connect(Hold));
		this.TrackConnection(UserInputService.WindowFocusReleased.Connect(Hold));
		this.TrackConnection(GuiService.MenuOpened.Connect(Hold));
	}
}

/** `InputActions.Create`: builds the typed handle on the client */
export function Create<S extends Record<string, IContextSchema>>(
	schema: IInputSchema<S>,
	options?: ICreateOptions,
): InputHandle<S> {
	if (!RunService.IsClient()) error("InputActions.Create runs on the client only", 2);
	if (!game.IsLoaded()) game.Loaded.Wait();
	const runtime = new InputRuntime();
	const [ok, problem] = pcall(() => runtime.Build(schema.Contexts, options ?? {}));
	if (!ok) {
		runtime.Destroy();
		error(problem, 0);
	}
	return runtime.Root as unknown as InputHandle<S>;
}
