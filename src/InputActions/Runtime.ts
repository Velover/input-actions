import {
	GuiService,
	HttpService,
	Players,
	ReplicatedStorage,
	RunService,
	UserInputService,
} from "@rbxts/services";
import { EveryFrame } from "../Internal/EveryFrame";
import { WarnIfNotServerAuthority } from "./AuthorityMode";
import { CheckBindingKeys } from "./BindingRules";
import {
	AddingBindings,
	ApplySpec,
	FillPlaceholder,
	IBindingValues,
	ReadBinding,
	SpecReleasedThreshold,
	WriteBinding,
	WriteBindings,
} from "./BindingState";
import { ExportBindings, ImportBindings, ResetBindings } from "./BindingsJson";
import { SCRIPTABLE, SchemaProblem } from "./Builders";
import {
	ActionHandle,
	IMovedBindings,
	MoveBindings,
	RefireHeldValues,
	ReleaseHeldValues,
	TakeHeldValues,
} from "./Handles/ActionHandle";
import { BindingHandle, ScriptableBindingHandle } from "./Handles/BindingHandle";
import { ContextHandle, ContextState } from "./Handles/ContextHandle";
import { Entries, IRuntime, JoinPath, NEUTRAL_VALUES, ReleaseOnServer } from "./Internal";
import {
	AddUser,
	ClaimCopy,
	GetEntry,
	ISharedEntry,
	IsPackageMade,
	IsShared,
	RemoveUser,
} from "./Registry";
import {
	ActionSlots,
	CheckPlayerFolderName,
	CreateAction,
	CreateContext,
	DEFAULT_PLAYER_FOLDER_NAME,
	DEFAULT_TIMEOUT,
	FindAction,
	FindBinding,
	FindContext,
	ISlot,
	IsPackageBindingName,
	MatchesSlot,
	WarnUnmentioned,
} from "./Tree";
import type {
	ICheckedInputSchema,
	IActionDefinition,
	IContextSchema,
	ICreateOptions,
	IImportResult,
	InputHandle,
	ISchema,
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

/** The default folder when it exists: `ReplicatedStorage.Inputs`, the one the Input Action Manager writes */
function FindDefaultFolder(): Instance | undefined {
	return ReplicatedStorage.FindFirstChild("Inputs");
}

/** The default folder, made when missing */
export function GetDefaultFolder(): Instance {
	const existing = FindDefaultFolder();
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

/**
 * Resets an action that `Destroy` left held: a binding destroyed while it holds its action leaves the
 * action stuck on (probed), and IAS resets a disabled action. Under Server Authority the release
 * pairs before have let go of the server's copy already (`ReleaseOnServer`); this covers a local
 * context, and a copy under the player in a place without Server Authority, where no pair is fired:
 * also an action another root handle still uses, when `ReleaseOwn` says so (hunt HL4-3). An action
 * the package made and destroyed needs nothing.
 */
function ResetIfHeld(action: InputAction) {
	if (action.Parent === undefined || !action.Enabled) return;
	if (action.GetState() === NEUTRAL_VALUES[action.Type.Name]) return;
	action.Enabled = false;
	action.Enabled = true;
}

/**
 * An action's bindings: the schema's, the devices' extras included, and the three devices', which
 * every action has (a device the schema leaves out gets an unbound binding)
 */
function SlotsOf(definition: AnyDefinition): ISlot[] {
	return ActionSlots(definition.Bindings as Record<string, unknown>);
}

/** The names an action's bindings are found by (`S` or `<Action>S`) */
function SlotNames(definition: AnyDefinition): string[] {
	return SlotsOf(definition).map((slot) => slot.Name);
}

/**
 * A schema that names a device whose binding another root handle made unbound (its schema left the
 * device out) fills it: see `FillPlaceholder`
 */
function FillSpecInto(binding: InputBinding, spec: unknown) {
	const defaults = GetEntry(binding)?.Defaults;
	if (defaults === undefined) return;
	const values: IBindingValues = { ...defaults };
	ApplySpec(values, spec);
	FillPlaceholder(binding, values, SpecReleasedThreshold(spec));
}

/** The template's action of that name, when it has one */
function TemplateAction(template: InputContext | undefined, name: string): InputAction | undefined {
	const action = template?.FindFirstChild(name);
	return action !== undefined && action.IsA("InputAction") ? action : undefined;
}

/**
 * The context whose actions `Build` would take up for a context of the schema, as the tree is now:
 * the folder's; for a Server Authority context the server's copy when it has every action, else the
 * stand-in other root handles wait on (unless the copy takes them up first), else the template the
 * new stand-in is cloned from. Undefined when the context is to be made. Throws as `Build` does on
 * an instance of that name that is no InputContext.
 */
function ContextToBuildOn(
	name: string,
	schema: IContextSchema,
	folder: Instance | undefined,
	playerFolderName: string,
): InputContext | undefined {
	const found = folder !== undefined ? FindContext(folder, name, name) : undefined;
	if (schema.ServerAuthority !== true) return found;
	const copy = Players.LocalPlayer.FindFirstChild(playerFolderName)?.FindFirstChild(name);
	if (copy !== undefined && copy.IsA("InputContext") && HasActions(copy, schema)) return copy;
	const standIn = standIns.get(`${playerFolderName}/${name}`);
	if (standIn !== undefined && !IsCopyReady(standIn, copy)) return standIn.Instance;
	return found;
}

/**
 * Every check of `Build` that can throw, made before it changes anything, so a `Create` that throws
 * leaves the tree as it was: it fills no other root handle's unbound binding and releases no held
 * action (hunt HD-2). First every check of `Schema` (`SchemaProblem`), for a schema made without
 * it: a "/" in a name (hunt HD2-5), a misspelt option, which would make a `ServerAuthorty: true`
 * context local without a word (hunt HD3-2), a binding that breaks the rules. Then each action the
 * tree already has against the type the schema declares. `folder` is undefined when the default
 * folder doesn't exist yet: it is made only once these checks pass.
 */
function CheckBuild(
	contexts: Record<string, IContextSchema>,
	folder: Instance | undefined,
	playerFolderName: string,
) {
	const found = SchemaProblem(contexts);
	if (found !== undefined) error(`InputActions.Create: ${found.Path}: ${found.Problem}`, 0);
	for (const [name, schema] of Entries(contexts)) {
		const context = ContextToBuildOn(name, schema, folder, playerFolderName);
		if (context === undefined) continue;
		for (const [actionName, definition] of Entries(schema.Actions)) {
			FindAction(context, actionName, definition.Type, JoinPath(name, actionName));
		}
	}
}

/**
 * The server makes its copy enabled, since IAS on the server ignores the client's input for a
 * context or action the server disabled (probed), and the client owns `Enabled`. The first time the
 * package takes up the copy, the context and the actions the template or the schema has get the
 * template's `Enabled` (as the designer left it), else the schema's.
 */
function ClaimCopyEnabled(
	copy: InputContext,
	template: InputContext | undefined,
	templateEnabled: boolean,
	schema: IContextSchema,
) {
	if (ClaimCopy(copy))
		copy.Enabled = template !== undefined ? templateEnabled : (schema.Enabled ?? true);
	for (const action of copy.GetChildren()) {
		if (!action.IsA("InputAction")) continue;
		const templateAction = TemplateAction(template, action.Name);
		const definition = schema.Actions[action.Name] as AnyDefinition | undefined;
		// Neither says anything: another schema's action, left to the root handle that has it
		if (templateAction === undefined && definition === undefined) continue;
		if (ClaimCopy(action)) action.Enabled = templateAction?.Enabled ?? definition?.Enabled ?? true;
	}
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

	GoesWithRoot(instance: Instance) {
		return this._used.has(instance) && IsPackageMade(instance) && !IsShared(instance);
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
		/** Actions another root handle uses that a key or a button of this one's bindings holds */
		const shared = new Array<InputAction>();
		for (const context of this._contexts) {
			for (const [, action] of pairs(context.Actions)) {
				actions.push(action);
				// Another root handle still uses it: only what this one holds is let go
				if (IsShared(action.Instance)) {
					if (action.ReleaseOwn()) shared.push(action.Instance);
					continue;
				}
				owned.push(action);
				action.Release();
			}
		}
		// The template's bindings the package gave them go with their last user
		const extras = this._extraActions.filter((action) => !IsShared(action));
		for (const action of extras) ReleaseOnServer(action);
		for (const context of this._contexts) context.Destroy();
		for (let index = this._uses.size() - 1; index >= 0; index--) {
			const instance = this._uses[index];
			const entry = RemoveUser(instance);
			if (entry === undefined) continue;
			if (entry.Created) instance.Destroy();
			else if (entry.TemplateEnabled !== undefined) {
				if (instance.Parent !== undefined)
					(instance as InputContext).Enabled = entry.TemplateEnabled;
			} else if (entry.Defaults !== undefined)
				WriteBindings([[instance as InputBinding, entry.Defaults]]);
		}
		this._uses.clear();
		this._used.clear();
		// A key or button binding destroyed above while it held its action: the action stays held
		for (const action of owned) ResetIfHeld(action.Instance);
		for (const action of extras) ResetIfHeld(action);
		for (const action of shared) ResetIfHeld(action);
		for (const action of actions) action.Destroy();
		this._bindingsChanged.Destroy();
	}

	// ---- building

	Build(contexts: Record<string, IContextSchema>, options: ICreateOptions) {
		const playerFolderName = options.PlayerFolderName ?? DEFAULT_PLAYER_FOLDER_NAME;
		CheckPlayerFolderName(playerFolderName);
		// The default folder is made only once the checks pass: a Create that throws leaves none
		CheckBuild(contexts, options.Folder ?? FindDefaultFolder(), playerFolderName);
		const folder = options.Folder ?? GetDefaultFolder();

		for (const [name, schema] of pairs(contexts)) {
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
		if (waiting !== undefined && IsCopyReady(waiting, copy))
			InputRuntime.LinkStandIn(waiting, copy);
		if (copy !== undefined && copy.IsA("InputContext") && HasActions(copy, schema)) {
			ClaimCopyEnabled(copy, template, templateEnabled, schema);
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
			const slots = SlotNames(definition);
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
			// Added to an action that is held, they make IAS reset it (hunt HL4-4)
			AddingBindings(action, () => {
				for (const binding of templateAction.GetChildren()) {
					if (binding.IsA("InputBinding")) this.CloneOrAdopt(binding, action);
				}
			});
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
						if (
							(action === undefined || !action.IsA("InputAction")) &&
							!missing.includes(actionName)
						)
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
	 * handles point at the copy and are marked linked, the context's state (base state and every
	 * handle's requests) goes with them, the labels follow and the listeners hear the copy's state,
	 * the stand-in is destroyed, the values the Scriptable bindings held are fired again, and
	 * `LinkedToServer` fires. Under Immediate signals listeners run inside the swap: first in the
	 * releases of the held values, before the copy is touched, then none between the moves and the
	 * marks, and a root handle one destroys takes no further part (hunt HL2-2, HL2-3, HL3-1).
	 * Defaults don't change, so `Reset` still returns to the same ones, except on a binding adopted
	 * from a root handle already on the copy: the stand-in's rebinds are written onto it, and it
	 * keeps that handle's defaults, which every handle on it shares. A copy whose actions are of
	 * another Type leaves the handles on the stand-in.
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

		// The held values are released first, on every action, before anything touches the copy:
		// under Immediate signals the releases run listeners, which find everything on the stand-in
		const source = standIn.Instance;
		const targets = new Array<[InputAction, InputAction]>();
		for (const action of source.GetChildren()) {
			if (!action.IsA("InputAction")) continue;
			const target = copy.FindFirstChild(action.Name);
			if (target === undefined || !target.IsA("InputAction")) continue;
			ReleaseHeldValues(action);
			targets.push([action, target]);
		}
		// A root handle a listener destroyed takes no further part: its uses of the copy would
		// outlive it (hunt HL2-3). With none left, the copy stays as the server made it, unclaimed:
		// the next Create takes it up first, and a Create made by a listener has done so (HL3-1)
		const live = links.filter((link) => !link.Runtime._destroyed);
		if (live.isEmpty()) return;
		// What the Scriptable bindings hold once every release ran: a value a listener fired during
		// them is carried over too, and wins over the one it replaced (hunt HL4-2)
		const carried = targets.map(([action]) => TakeHeldValues(action));
		// Every action of the stand-in moves its bindings once, a template's extras included. The
		// server's copy is enabled, and the client owns Enabled: the copy takes the stand-in's, unless
		// another root handle took it up first
		const moves = new Map<InputAction, IMovedBindings>();
		ClaimCopy(copy);
		targets.forEach(([action, target], index) => {
			ClaimCopy(target);
			const carryEnabled = GetEntry(target) === undefined;
			moves.set(action, MoveBindings(action, target, carryEnabled, carried[index]));
		});
		// No listener runs from here until every handle is on the copy and marked linked, but for the
		// copy's own events when a binding moved onto one of its actions that another root handle's
		// input holds lets go of it (`MoveBindings`)
		const linked = new Array<ActionHandle>();
		for (const link of live) {
			const runtime = link.Runtime;
			for (const [, handle] of pairs(link.Handle.Actions)) {
				const moved = moves.get(handle.Instance)!;
				runtime.Use(moved.Target);
				handle.LinkTo(moved.Target, moved.Moved);
				linked.push(handle);
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
		// Marked before any listener runs again: Immediate signals run them inside the writes and
		// Fires below, and they must find every handle linked (hunt HL-3, HL2-2). A root handle they
		// destroy has let go of its uses itself, and its handles skip what is left
		const marked = live.filter((link) => link.Handle.MarkLinked());

		const state = live[0].Handle.GetSharedState();
		const entry = GetEntry(copy)!;
		if (entry.Context === undefined) {
			entry.Context = state;
			state.MoveTo(copy);
		} else {
			entry.Context.Join([...state.Handles]);
		}
		for (const handle of linked) handle.FinishLink();
		source.Enabled = false;
		source.Destroy();
		for (const link of links) link.Runtime.DropUse(source);
		for (const [, moved] of moves) RefireHeldValues(moved);
		for (const link of marked) link.Handle.NotifyLinked();
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
		// The slots' names were checked before anything was built (`CheckBuild`)
		const slots = SlotsOf(definition);
		const names = slots.map((slot) => slot.Name);
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
		// A binding added to an action that is held makes IAS reset it (another root handle's, or
		// the server's copy), and so does a fill that changes a binding's keys: it is let go of then
		// (hunts HL4-4, HL4-5). Every device has a binding, unbound when the schema leaves it out
		// (spec undefined), and a device's extras (0.7.0) are added with the rest
		const target = action;
		AddingBindings(target, () => {
			for (const slot of slots) {
				const binding = this.BuildBinding(contextHandle, target, actionName, slot, templateAction);
				// An extra hangs off its device's main binding's handle, made before it (`ActionSlots`)
				if (slot.Extra === undefined) handle.Bindings[slot.Name] = binding;
				else
					(handle.Bindings[slot.Device!] as BindingHandle).AddExtra(
						slot.Extra,
						binding as BindingHandle,
					);
			}

			// Template bindings that fill no slot run beside the package's own ones, as in the template
			if (templateAction !== undefined) {
				for (const binding of templateAction.GetChildren()) {
					if (!binding.IsA("InputBinding") || MatchesSlot(actionName, binding.Name, names))
						continue;
					this.CloneOrAdopt(binding, target);
				}
			}
		});
		if (warnExtras && !created) {
			for (const binding of action.GetChildren()) {
				if (!binding.IsA("InputBinding") || MatchesSlot(actionName, binding.Name, names)) continue;
				if (!IsPackageBindingName(actionName, binding.Name)) WarnUnmentioned(binding);
			}
		}

		contextHandle.Actions[actionName] = handle;
		if (handle.IsTracked()) this._tracked.push(handle);
	}

	/**
	 * Gets or creates the binding of one slot: found as `S` or `<Action>S`, made as `<Action>S`, where
	 * `S` is the device, `<Device><Extra>` for a device's extra, or the Scriptable slot's name. Its path
	 * (saves, `BindingsChanged`) is `Context/Action/<Device or Slot>`, `.../<Device>/<Extra>` for an
	 * extra. The slot's spec is undefined for a device the schema leaves out, whose binding is made
	 * unbound (a placeholder, which a later root handle's schema that names the device fills); an
	 * extra is always declared, and never one
	 */
	private BuildBinding(
		contextHandle: ContextHandle,
		action: InputAction,
		actionName: string,
		slot: ISlot,
		templateAction: InputAction | undefined,
	): BindingHandle | ScriptableBindingHandle {
		const spec = slot.Spec;
		const path =
			slot.Extra !== undefined
				? JoinPath(contextHandle.Name, actionName, slot.Device!, slot.Extra)
				: JoinPath(contextHandle.Name, actionName, slot.Name);
		// Its name was checked before anything was built (`CheckBuild`)
		const scriptable = spec === SCRIPTABLE;
		let binding = FindBinding(action, actionName, slot.Name);
		// Found: the designer's, or one another root handle on this folder made
		if (binding !== undefined) this.Use(binding);
		else if (templateAction !== undefined) {
			const template = FindBinding(templateAction, actionName, slot.Name);
			if (template !== undefined) binding = this.CloneBinding(template, action);
		}

		if (binding === undefined) {
			binding = new Instance("InputBinding");
			binding.Name = actionName + slot.Name;
			if (scriptable) binding.Type = Enum.InputBindingType.Scriptable;
			else if (spec !== undefined) {
				const values = ReadBinding(binding);
				ApplySpec(values, spec);
				WriteBinding(binding, values, SpecReleasedThreshold(spec));
			}
			binding.Parent = action;
			this.TrackCreated(binding);
			if (spec === undefined) GetEntry(binding)!.Placeholder = true;
		} else if (scriptable !== (binding.Type === Enum.InputBindingType.Scriptable)) {
			warn(
				`InputActions: ${path}: ${binding.GetFullName()} is ${binding.Type.Name}, but the schema declares ` +
					`${scriptable ? "InputActions.Scriptable" : "a key binding"}; left as it is`,
			);
		} else if (!scriptable) {
			if (spec !== undefined) FillSpecInto(binding, spec);
			const problem = CheckBindingKeys(action.Type.Name, binding, slot.Device);
			if (problem !== undefined)
				warn(`InputActions: ${path}: ${binding.GetFullName()}: ${problem}; left as it is`);
		}

		if (scriptable) {
			return new ScriptableBindingHandle(this, binding, slot.Name, NEUTRAL_VALUES[action.Type.Name]);
		}
		// Every root handle on this binding shares the defaults the first one took. A key binding is
		// a device's, main or extra: BindingNameProblem refused any other name
		const entry = GetEntry(binding)!;
		entry.Defaults ??= ReadBinding(binding);
		const device = slot.Device!;
		const handle = new BindingHandle(this, binding, path, action.Type.Name, device, entry.Defaults);
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

/**
 * `InputActions.Create`: builds the typed handle on the client. `Schema`'s result first, as it is,
 * then any schema, checked (see `ISchema`, hunt HD4-3)
 */
export function Create<S extends Record<string, IContextSchema>>(
	schema: ISchema<S>,
	options?: ICreateOptions,
): InputHandle<S>;
export function Create<S extends Record<string, IContextSchema>>(
	schema: ICheckedInputSchema<S>,
	options?: ICreateOptions,
): InputHandle<S>;
export function Create<S extends Record<string, IContextSchema>>(
	schema: ICheckedInputSchema<S>,
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
	WarnIfNotServerAuthority("InputActions.Create", schema.Contexts);
	return runtime.Root as unknown as InputHandle<S>;
}
