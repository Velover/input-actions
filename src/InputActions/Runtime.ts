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
import { ApplySpec } from "./BindingState";
import { ExportBindings, ImportBindings, ResetBindings } from "./BindingsJson";
import { SCRIPTABLE } from "./Builders";
import { ActionHandle, IsPackageBindingName } from "./Handles/ActionHandle";
import { BindingHandle, ScriptableBindingHandle } from "./Handles/BindingHandle";
import { ContextHandle } from "./Handles/ContextHandle";
import { Entries, IRuntime, JoinPath } from "./Internal";
import {
	CheckActionType,
	CheckPlayerFolderName,
	CreateAction,
	CreateContext,
	DEFAULT_PLAYER_FOLDER_NAME,
	DEFAULT_TIMEOUT,
	FindAction,
	FindBinding,
	FindContext,
	MatchesSlot,
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

/** A Server Authority context running on a local stand-in until the server's copy arrives */
interface IPendingLink {
	Name: string;
	Schema: IContextSchema;
	Handle: ContextHandle;
	StandIn: InputContext;
}

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

/** The root handle `Create` returns. Contexts are added to it as properties, by name */
export class InputRuntime implements IRuntime {
	readonly BindingsChanged: RBXScriptSignal<(path: string) => void>;

	private readonly _bindingsChanged = new Instance("BindableEvent");
	private readonly _contexts = new Array<ContextHandle>();
	private readonly _bindings = new Array<BindingHandle>();
	private readonly _tracked = new Array<ActionHandle>();
	private readonly _created = new Array<Instance>();
	private readonly _connections = new Array<RBXScriptConnection>();
	/** Server Authority templates disabled locally, with the Enabled to give back */
	private readonly _disabledTemplates = new Map<InputContext, boolean>();
	private readonly _pendingLinks = new Array<IPendingLink>();
	private _standInFolder?: Folder;
	private _linking?: RBXScriptConnection;
	private _stopSnapshots?: () => void;
	private _focusReleases?: Array<() => void>;
	private _destroyed = false;

	constructor() {
		this.BindingsChanged = this._bindingsChanged.Event as RBXScriptSignal<(path: string) => void>;
	}

	// ---- IRuntime

	NotifyBindingChanged(path: string) {
		if (!this._destroyed) this._bindingsChanged.Fire(path);
	}

	TrackCreated(instance: Instance) {
		this._created.push(instance);
	}

	TrackConnection(connection: RBXScriptConnection) {
		this._connections.push(connection);
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

	Destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		this._stopSnapshots?.();
		for (const connection of this._connections) connection.Disconnect();
		this._connections.clear();
		// A held binding that is destroyed leaves its action stuck on (probed): release them first
		const actions = new Array<ActionHandle>();
		for (const context of this._contexts) {
			for (const [, action] of pairs(context.Actions)) {
				actions.push(action);
				action.ReleaseScriptableBindings();
			}
		}
		for (const context of this._contexts) context.Destroy();
		for (const [template, enabled] of this._disabledTemplates) {
			if (template.Parent !== undefined) template.Enabled = enabled;
		}
		for (let index = this._created.size() - 1; index >= 0; index--) this._created[index].Destroy();
		this._created.clear();
		for (const action of actions) {
			if (action.Instance.Parent !== undefined && action.IsPressed()) action.ResetState();
			action.Destroy();
		}
		this._bindingsChanged.Destroy();
	}

	// ---- building

	Build(contexts: Record<string, IContextSchema>, options: ICreateOptions) {
		const folder = options.Folder ?? GetDefaultFolder();
		const playerFolderName = options.PlayerFolderName ?? DEFAULT_PLAYER_FOLDER_NAME;
		CheckPlayerFolderName(playerFolderName);

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

	private AddContext(handle: ContextHandle) {
		this._contexts.push(handle);
		(this as unknown as Record<string, ContextHandle>)[handle.Name] = handle;
	}

	private BuildContext(name: string, schema: IContextSchema, folder: Instance) {
		let context = FindContext(folder, name, name);
		const created = context === undefined;
		context ??= CreateContext(name, schema.Priority, schema.Sink, schema.Enabled);
		const handle = new ContextHandle(this, context, name);
		for (const [actionName, definition] of Entries(schema.Actions)) {
			this.BuildAction(handle, context, actionName, definition, undefined, !created);
		}
		if (created) {
			context.Parent = folder;
			this.TrackCreated(context);
		} else {
			for (const child of context.GetChildren()) {
				if (child.IsA("InputAction") && schema.Actions[child.Name] === undefined)
					WarnUnmentioned(child);
			}
		}
		this.AddContext(handle);
	}

	/**
	 * `Create` never waits for the server. When the server's copy under the player is already
	 * there, the bindings are added to it, locally: from the template in the folder when it has
	 * them, else from the schema. Otherwise the context runs on a local stand-in (a clone of the
	 * template, or built from the schema) until the copy arrives (`LinkToServerCopy`).
	 */
	private BuildServerAuthorityContext(
		name: string,
		schema: IContextSchema,
		folder: Instance,
		playerFolderName: string,
	) {
		const template = FindContext(folder, name, name);
		const templateEnabled = template?.Enabled;
		if (template !== undefined && !this._disabledTemplates.has(template)) {
			// The template would otherwise process the same keys beside the player's copy
			this._disabledTemplates.set(template, template.Enabled);
			template.Enabled = false;
		}
		if (template !== undefined) this.WarnTemplateExtras(template, schema);

		const copy = Players.LocalPlayer.FindFirstChild(playerFolderName)?.FindFirstChild(name);
		if (copy !== undefined && copy.IsA("InputContext") && HasActions(copy, schema)) {
			const handle = new ContextHandle(this, copy, name, true, true);
			for (const [actionName, definition] of Entries(schema.Actions)) {
				const templateAction = template?.FindFirstChild(actionName);
				this.BuildAction(
					handle,
					copy,
					actionName,
					definition,
					templateAction !== undefined && templateAction.IsA("InputAction")
						? templateAction
						: undefined,
					false,
				);
			}
			this.CloneExtraBindings(copy, template, schema);
			this.AddContext(handle);
			return;
		}

		let standIn: InputContext;
		if (template !== undefined) {
			standIn = template.Clone();
			standIn.Enabled = templateEnabled!;
		} else {
			standIn = CreateContext(name, schema.Priority, schema.Sink, schema.Enabled);
		}
		const handle = new ContextHandle(this, standIn, name, true, false);
		for (const [actionName, definition] of Entries(schema.Actions)) {
			this.BuildAction(handle, standIn, actionName, definition, undefined, false);
		}
		// Everything in the stand-in is the package's, including the bindings cloned with the template
		for (const descendant of standIn.GetDescendants()) {
			if (descendant.IsA("InputBinding")) this.TrackCreated(descendant);
		}
		standIn.Parent = this.GetStandInFolder();
		this.TrackCreated(standIn);
		this._pendingLinks.push({ Name: name, Schema: schema, Handle: handle, StandIn: standIn });
		this.AddContext(handle);
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
			for (const binding of templateAction.GetChildren()) {
				if (binding.IsA("InputBinding") && action.FindFirstChild(binding.Name) === undefined) {
					this.CloneBinding(binding, action);
				}
			}
		}
	}

	/** A client-only folder for the stand-ins; the server never sees it */
	private GetStandInFolder(): Folder {
		if (this._standInFolder === undefined) {
			const folder = new Instance("Folder");
			folder.Name = "InputActionsStandIns";
			folder.Parent = ReplicatedStorage;
			this.TrackCreated(folder);
			this._standInFolder = folder;
		}
		return this._standInFolder;
	}

	/** Swaps each stand-in for the server's copy once it arrives; warns once after `timeout` */
	private WatchForServerCopies(playerFolderName: string, timeout: number) {
		const connection = RunService.Heartbeat.Connect(() => {
			const folder = Players.LocalPlayer.FindFirstChild(playerFolderName);
			if (folder === undefined) return;
			for (let index = this._pendingLinks.size() - 1; index >= 0; index--) {
				const pending = this._pendingLinks[index];
				const copy = folder.FindFirstChild(pending.Name);
				if (copy === undefined || !copy.IsA("InputContext") || !HasActions(copy, pending.Schema))
					continue;
				this._pendingLinks.remove(index);
				this.LinkToServerCopy(pending, copy);
			}
			if (this._pendingLinks.size() === 0) {
				connection.Disconnect();
				this._standInFolder?.Destroy();
			}
		});
		this.TrackConnection(connection);

		task.delay(timeout, () => {
			if (this._destroyed || this._pendingLinks.size() === 0) return;
			const names = this._pendingLinks.map((pending) => pending.Name);
			names.sort();
			warn(
				`InputActions.Create: after ${timeout} s the server's copy of ${names.join(", ")} has not ` +
					`arrived under ${Players.LocalPlayer.Name}.${playerFolderName}. Until it does, these ` +
					"contexts run on a local stand-in whose state never reaches the server. Is " +
					"InputActions.ProvideToPlayers called on the server, with the same PlayerFolderName " +
					`("${playerFolderName}")?`,
			);
		});
	}

	/**
	 * Moves a stand-in's bindings (rebinds, attached buttons and all) under the server's actions,
	 * points the handles at the server's copy, destroys the stand-in, then fires again the values
	 * the Scriptable bindings held. Defaults don't change, so `Reset` still returns to the same ones.
	 */
	private LinkToServerCopy(pending: IPendingLink, copy: InputContext) {
		for (const [actionName, definition] of Entries(pending.Schema.Actions)) {
			const action = copy.FindFirstChild(actionName) as InputAction;
			if (action.Type !== definition.Type) {
				warn(
					`InputActions: ${JoinPath(pending.Name, actionName)}: the server's copy is a ${action.Type.Name} ` +
						`action, but the schema declares ${definition.Type.Name}; staying on the local stand-in`,
				);
				return;
			}
		}

		const held = new Array<[ActionHandle, Map<InputBinding, unknown>]>();
		for (const [actionName, handle] of pairs(pending.Handle.Actions)) {
			held.push([handle, handle.MoveTo(copy.FindFirstChild(actionName) as InputAction)]);
		}
		// Actions of the template the schema doesn't mention take their bindings along too
		for (const child of pending.StandIn.GetChildren()) {
			if (!child.IsA("InputAction") || pending.Schema.Actions[child.Name] !== undefined) continue;
			const target = copy.FindFirstChild(child.Name);
			if (target === undefined || !target.IsA("InputAction")) continue;
			for (const binding of child.GetChildren()) {
				if (binding.IsA("InputBinding") && target.FindFirstChild(binding.Name) === undefined) {
					binding.Parent = target;
				}
			}
		}

		pending.Handle.LinkTo(copy);
		pending.StandIn.Enabled = false;
		pending.StandIn.Destroy();
		for (const [handle, values] of held) handle.RefireScriptableValues(values);
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
		}

		const handle = new ActionHandle(this, action, actionName, definition.TrackPrevious);
		const slots = new Array<string>();
		for (const [slot, spec] of pairs(definition.Bindings as Record<string, unknown>)) {
			slots.push(slot);
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
				if (action.FindFirstChild(binding.Name) === undefined) this.CloneBinding(binding, action);
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
		const scriptable = spec === SCRIPTABLE;
		let binding = FindBinding(action, actionName, slot);
		if (binding === undefined && templateAction !== undefined) {
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

		if (scriptable) return new ScriptableBindingHandle(binding, slot);
		const handle = new BindingHandle(this, binding, path, action.Type.Name, slot);
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
	return runtime as unknown as InputHandle<S>;
}
