import { ExportBindings, ImportBindings, ResetBindings } from "../BindingsJson";
import type { IRuntime } from "../Internal";
import type { IImportResult } from "../Types";
import type { ActionHandle } from "./ActionHandle";
import type { BindingHandle } from "./BindingHandle";

/**
 * The handle of one context. It owns `InputContext.Enabled`: the effective state is `false` while
 * any `Request(false)` is held, else `true` while any `Request(true)` is held, else the base state.
 */
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
	private _base: boolean;
	private _effective: boolean;
	private _falseRequests = 0;
	private _trueRequests = 0;
	private _linked: boolean;

	// A parameter named `Instance` would shadow the global in the field initializers
	constructor(
		private readonly _runtime: IRuntime,
		context: InputContext,
		name: string,
		private readonly _serverAuthority = false,
		linked = false,
	) {
		this.Instance = context;
		this.Name = name;
		this.EnabledChanged = this._enabledChanged.Event as RBXScriptSignal<(enabled: boolean) => void>;
		this.LinkedToServer = this._linkedToServer.Event as RBXScriptSignal<() => void>;
		this._base = context.Enabled;
		this._effective = context.Enabled;
		this._linked = linked;
	}

	SetEnabled(enabled: boolean) {
		this._base = enabled;
		this.Update();
	}

	IsEnabled() {
		return this._effective;
	}

	Request(enabled: boolean): () => void {
		if (enabled) this._trueRequests++;
		else this._falseRequests++;
		this.Update();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (enabled) this._trueRequests--;
			else this._falseRequests--;
			this.Update();
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

	IsLinkedToServer() {
		return this._linked;
	}

	/** Points the handle at the server's copy, which takes the effective state the handle holds */
	LinkTo(context: InputContext) {
		this.Instance = context;
		context.Enabled = this._effective;
		this._linked = true;
		this._linkedToServer.Fire();
	}

	/** Gives the instance back its base state (requests end with the handle) */
	Destroy() {
		if (this.Instance.Parent !== undefined) this.Instance.Enabled = this._base;
		this._enabledChanged.Destroy();
		this._linkedToServer.Destroy();
	}

	private Update() {
		const effective = this._falseRequests > 0 ? false : this._trueRequests > 0 ? true : this._base;
		if (effective === this._effective) return;
		this._effective = effective;
		if (!this._runtime.IsDestroyed()) {
			// Fired before disabling: a Fire on a disabled context is ignored
			if (!effective && this._serverAuthority) {
				for (const [, action] of pairs(this.Actions)) action.ReleaseScriptableBindings();
			}
			this.Instance.Enabled = effective;
		}
		this._enabledChanged.Fire(effective);
	}
}
