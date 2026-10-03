import { ExportBindings, ImportBindings, ResetBindings } from "../BindingsJson";
import { ConflictSubject, FindAllConflicts, FindConflicts } from "../Conflicts";
import { IRuntime, MarkReset, ReleaseOnServer } from "../Internal";
import type { IBindingConflict, IConflictPair, IImportResult } from "../Types";
import type { ActionHandle } from "./ActionHandle";
import type { BindingHandle } from "./BindingHandle";

/**
 * The enabled state of one InputContext, shared by every handle that wraps it (`Create` twice on
 * one folder). It owns `InputContext.Enabled`: the effective state is `false` while any
 * `Request(false)` is held, else `true` while any `Request(true)` is held, else the base state.
 */
export class ContextState {
	Instance: InputContext;
	Base: boolean;
	Effective: boolean;
	FalseRequests = 0;
	TrueRequests = 0;
	readonly Handles = new Array<ContextHandle>();

	// A parameter named `Instance` would shadow the global in the field initializers
	constructor(context: InputContext, base = context.Enabled, effective = context.Enabled) {
		this.Instance = context;
		this.Base = base;
		this.Effective = effective;
	}

	/** Writes the effective state when it changed, and tells the handles; returns whether it did */
	Update(): boolean {
		if (!this.Write()) return false;
		for (const handle of [...this.Handles]) handle.NotifyEnabledChanged(this.Effective);
		return true;
	}

	/**
	 * The handles of another state (a stand-in's) move onto this one with their requests, all at
	 * once: a root handle whose schema the copy satisfied before theirs uses it already. This state's
	 * base state wins. Each handle's listeners hear the effective state only when it differs from
	 * what that handle had, so a joining handle whose state doesn't change hears nothing.
	 */
	Join(handles: readonly ContextHandle[]) {
		const was = this.Effective;
		const before = new Map<ContextHandle, boolean>();
		for (const handle of handles) {
			before.set(handle, handle.IsEnabled());
			handle.MoveToState(this);
		}
		this.Write();
		if (this.Instance.Enabled !== this.Effective) this.Instance.Enabled = this.Effective;
		const effective = this.Effective;
		for (const handle of [...this.Handles]) {
			if ((before.get(handle) ?? was) !== effective) handle.NotifyEnabledChanged(effective);
		}
	}

	/**
	 * The server's copy takes over from a Server Authority stand-in: the state (base state and every
	 * handle's requests) carries over unchanged, so the handles' listeners hear nothing.
	 */
	MoveTo(copy: InputContext) {
		this.Instance = copy;
		for (const handle of this.Handles) handle.Instance = copy;
		// Last: under Immediate signals the write may run the actions' listeners (hunt HL2-2)
		copy.Enabled = this.Effective;
	}

	/** Writes the effective state to the instance when it changed; returns whether it did */
	private Write(): boolean {
		const effective = this.FalseRequests > 0 ? false : this.TrueRequests > 0 ? true : this.Base;
		if (effective === this.Effective) return false;
		this.Effective = effective;
		// Released before disabling: a Fire on a disabled context is ignored
		if (!effective) ReleaseActions(this.Instance, this.Handles);
		this.Instance.Enabled = effective;
		return true;
	}
}

/**
 * Releases every action of the context once, before it is disabled: the handles' actions, then, on a
 * server's copy, the actions the schema doesn't mention (a template's extras, which the package gave
 * the template's keys), which the server would otherwise keep held.
 */
function ReleaseActions(context: InputContext, handles: readonly ContextHandle[]) {
	// Every action of the context, another root handle's too: the disable releases what keys hold
	for (const child of context.GetChildren()) if (child.IsA("InputAction")) MarkReset(child);
	const released = new Set<InputAction>();
	for (const handle of handles) {
		for (const [, action] of pairs(handle.Actions)) {
			if (released.has(action.Instance)) continue;
			released.add(action.Instance);
			action.Release();
		}
	}
	for (const child of context.GetChildren()) {
		if (child.IsA("InputAction") && !released.has(child)) ReleaseOnServer(child);
	}
}

/** The handle of one context; its enabled state is shared with other handles on the same instance */
export class ContextHandle {
	/** The InputContext the handle wraps now */
	Instance: InputContext;
	readonly Name: string;
	readonly Actions: Record<string, ActionHandle> = {};
	readonly EnabledChanged: RBXScriptSignal<(enabled: boolean) => void>;
	/** Server Authority contexts: fires once, when the stand-in gives way to the server's copy */
	readonly LinkedToServer: RBXScriptSignal<() => void>;
	/** Every rebindable binding of this context's actions */
	readonly BindingHandles = new Array<BindingHandle>();

	private readonly _enabledChanged = new Instance("BindableEvent");
	private readonly _linkedToServer = new Instance("BindableEvent");
	private _state: ContextState;
	/** This handle's requests, counted in the shared state too */
	private _falseRequests = 0;
	private _trueRequests = 0;
	private _linked: boolean;
	private _destroyed = false;

	constructor(
		private readonly _runtime: IRuntime,
		state: ContextState,
		name: string,
		linked = false,
	) {
		this.Instance = state.Instance;
		this.Name = name;
		this.EnabledChanged = this._enabledChanged.Event as RBXScriptSignal<(enabled: boolean) => void>;
		this.LinkedToServer = this._linkedToServer.Event as RBXScriptSignal<() => void>;
		this._state = state;
		this._linked = linked;
		state.Handles.push(this);
	}

	SetEnabled(enabled: boolean) {
		if (this._destroyed) return;
		this._state.Base = enabled;
		this._state.Update();
	}

	IsEnabled() {
		return this._state.Effective;
	}

	Request(enabled: boolean): () => void {
		if (this._destroyed) return () => {};
		this.AddRequest(enabled, 1);
		this._state.Update();
		let released = false;
		return () => {
			// The handle's requests end with it
			if (released || this._destroyed) return;
			released = true;
			this.AddRequest(enabled, -1);
			this._state.Update();
		};
	}

	ExportBindings(): string {
		return ExportBindings(this.BindingHandles);
	}

	ImportBindings(json: string): IImportResult {
		return ImportBindings(this._runtime, this.BindingHandles, json, this.Name);
	}

	ResetBindings() {
		ResetBindings(this._runtime, this.BindingHandles);
	}

	/**
	 * The bindings of this context's actions that share a key with `binding`, of its device; with no
	 * binding, every pair of them that does (see `Conflicts.ts`)
	 */
	FindConflicts(binding?: unknown): IBindingConflict[] | IConflictPair[] {
		if (binding === undefined) return FindAllConflicts(this.BindingHandles);
		return FindConflicts(this.BindingHandles, ConflictSubject(binding, this.Name, 3));
	}

	IsLinkedToServer() {
		return this._linked;
	}

	/**
	 * Calls `callback` with the server's copy once the handle wraps it: at once, in the caller's
	 * thread, when it does already; else when the stand-in gives way (with `LinkedToServer`). The
	 * returned function cancels a call still to come; `Destroy` does too.
	 */
	WhenLinkedToServer(callback: (context: InputContext) => void): () => void {
		if (this._destroyed) return () => {};
		if (this._linked) {
			callback(this.Instance);
			return () => {};
		}
		const connection = this._linkedToServer.Event.Once(() => {
			if (!this._destroyed) callback(this.Instance);
		});
		return () => connection.Disconnect();
	}

	GetSharedState(): ContextState {
		return this._state;
	}

	NotifyEnabledChanged(enabled: boolean) {
		this._enabledChanged.Fire(enabled);
	}

	/** Moves the handle and its requests onto another state (`ContextState.Join` updates it) */
	MoveToState(state: ContextState) {
		this.Leave();
		this._state = state;
		this.Instance = state.Instance;
		state.Handles.push(this);
		state.FalseRequests += this._falseRequests;
		state.TrueRequests += this._trueRequests;
	}

	/**
	 * The handle now wraps the server's copy; true the first time. Marked before the swap runs any
	 * listener, and `NotifyLinked` tells the listeners at its end: under Immediate signals they run
	 * inside `Fire`, and must see every handle of the swap linked (hunt HL-3, HL2-2)
	 */
	MarkLinked(): boolean {
		if (this._linked) return false;
		this._linked = true;
		return true;
	}

	/** Fires `LinkedToServer` (and the `WhenLinkedToServer` calls) for a handle `MarkLinked` marked */
	NotifyLinked() {
		if (!this._destroyed) this._linkedToServer.Fire();
	}

	/**
	 * Ends the handle's requests. The last handle on a context gives the instance back its base
	 * state; otherwise the others' requests still apply.
	 */
	Destroy() {
		if (this._destroyed) return;
		this._destroyed = true;
		const state = this._state;
		this.Leave();
		if (state.Handles.size() > 0) state.Update();
		else if (state.Instance.Parent !== undefined) state.Instance.Enabled = state.Base;
		this._enabledChanged.Destroy();
		this._linkedToServer.Destroy();
	}

	private AddRequest(enabled: boolean, delta: number) {
		if (enabled) {
			this._trueRequests += delta;
			this._state.TrueRequests += delta;
		} else {
			this._falseRequests += delta;
			this._state.FalseRequests += delta;
		}
	}

	/** Takes the handle and its requests out of its current state */
	private Leave() {
		const state = this._state;
		const index = state.Handles.indexOf(this);
		if (index !== -1) state.Handles.remove(index);
		state.FalseRequests -= this._falseRequests;
		state.TrueRequests -= this._trueRequests;
	}
}
