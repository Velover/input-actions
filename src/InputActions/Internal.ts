/** What the handles need from the root handle that owns them */
export interface IRuntime {
	/** Fires BindingsChanged with the binding's path (`Context/Action/Slot`) */
	NotifyBindingChanged(path: string): void;
	/** An instance the package created: destroyed by `Destroy` */
	TrackCreated(instance: Instance): void;
	/** A connection disconnected by `Destroy` */
	TrackConnection(connection: RBXScriptConnection): void;
	IsDestroyed(): boolean;
}

/** `Context/Action/Slot` */
export function JoinPath(...parts: string[]): string {
	return parts.join("/");
}

/** The entries of a record keyed by names */
export function Entries<V>(record: { readonly [name: string]: V }): Array<[string, V]> {
	const list = new Array<[string, V]>();
	for (const [key, value] of pairs(record)) list.push([key as string, value as V]);
	return list;
}
