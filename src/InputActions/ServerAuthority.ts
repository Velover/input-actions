import { Players, ReplicatedStorage, RunService } from "@rbxts/services";
import { Entries, JoinPath } from "./Internal";
import {
	CheckActionType,
	CheckPlayerFolderName,
	CreateAction,
	CreateContext,
	DEFAULT_PLAYER_FOLDER_NAME,
	DEFAULT_TIMEOUT,
	FindAction,
	FindContext,
	WaitForChildren,
} from "./Tree";
import type {
	IContextSchema,
	IForPlayerOptions,
	IInputSchema,
	IProvideOptions,
	IServerActionHandle,
	ServerInputHandle,
} from "./Types";

// Server Authority (design spec §8). Keybinds stay on the client; the server only reads the action
// state, which IAS replicates on its own.

function ServerAuthorityContexts(contexts: Record<string, IContextSchema>) {
	const list = new Array<[string, IContextSchema]>();
	for (const [name, schema] of pairs(contexts))
		if (schema.ServerAuthority === true) list.push([name, schema]);
	return list;
}

/**
 * Adds the schema's actions the context lacks; throws on a Type mismatch. They are enabled whatever
 * the schema says: the client owns `Enabled` (see `ProvideToPlayers`).
 */
function AddMissingActions(context: InputContext, name: string, schema: IContextSchema) {
	for (const [actionName, definition] of Entries(schema.Actions)) {
		const path = JoinPath(name, actionName);
		if (FindAction(context, actionName, definition.Type, path) !== undefined) continue;
		CreateAction(actionName, definition.Type, definition.DisplayName).Parent = context;
	}
}

/**
 * Server: puts every Server Authority context into `player.<PlayerFolderName>` for each player, now
 * and as they join. A context with a template in the folder (the Input Action Manager's) is cloned
 * from it without its bindings; otherwise it is built from the schema. The copy and its actions are
 * enabled whatever the template or schema says: IAS on the server ignores the client's input for a
 * context or action the server disabled (probed), so the client owns `Enabled` and starts from the
 * template's or the schema's. Returns a function that stops providing.
 */
export function ProvideToPlayers<S extends Record<string, IContextSchema>>(
	schema: IInputSchema<S>,
	options?: IProvideOptions,
): () => void {
	if (!RunService.IsServer()) error("InputActions.ProvideToPlayers runs on the server only", 2);
	const playerFolderName = options?.PlayerFolderName ?? DEFAULT_PLAYER_FOLDER_NAME;
	CheckPlayerFolderName(playerFolderName);
	const folder = options?.Folder ?? ReplicatedStorage.FindFirstChild("Inputs");
	const contexts = ServerAuthorityContexts(schema.Contexts);

	// Checked once up front, so a mismatch throws here rather than as each player joins
	for (const [name, contextSchema] of contexts) {
		const template = folder !== undefined ? FindContext(folder, name, name) : undefined;
		if (template === undefined) continue;
		for (const [actionName, definition] of Entries(contextSchema.Actions)) {
			FindAction(template, actionName, definition.Type, JoinPath(name, actionName));
		}
	}

	const Provide = (player: Player) => {
		let playerFolder = player.FindFirstChild(playerFolderName);
		if (playerFolder === undefined) {
			playerFolder = new Instance("Folder");
			playerFolder.Name = playerFolderName;
			playerFolder.Parent = player;
		}
		for (const [name, contextSchema] of contexts) {
			const existing = FindContext(playerFolder, name, name);
			if (existing !== undefined) {
				AddMissingActions(existing, name, contextSchema);
				continue;
			}
			const template = folder !== undefined ? FindContext(folder, name, name) : undefined;
			let context: InputContext;
			if (template !== undefined) {
				context = template.Clone();
				context.Enabled = true;
				for (const descendant of context.GetDescendants()) {
					if (descendant.IsA("InputBinding")) descendant.Destroy();
					else if (descendant.IsA("InputAction")) descendant.Enabled = true;
				}
			} else {
				context = CreateContext(name, contextSchema.Priority, contextSchema.Sink);
			}
			context.Name = name;
			AddMissingActions(context, name, contextSchema);
			// Parented last, so the client receives the whole context at once
			context.Parent = playerFolder;
		}
	};

	for (const player of Players.GetPlayers()) Provide(player);
	const connection = Players.PlayerAdded.Connect(Provide);
	return () => connection.Disconnect();
}

class ServerActionHandle implements IServerActionHandle<Enum.InputActionType> {
	readonly Instance: InputAction;
	readonly Name: string;
	readonly StateChanged: RBXScriptSignal<(value: never) => void>;
	readonly Pressed: RBXScriptSignal<() => void>;
	readonly Released: RBXScriptSignal<() => void>;

	constructor(action: InputAction) {
		this.Instance = action;
		this.Name = action.Name;
		this.StateChanged = action.StateChanged;
		this.Pressed = action.Pressed;
		this.Released = action.Released;
	}

	GetState(): never {
		return this.Instance.GetState() as never;
	}
}

/**
 * Server: typed read-only handles over one player's Server Authority contexts. Waits (up to
 * `Timeout`) for them when `ProvideToPlayers` has not placed them yet.
 */
export function ForPlayer<S extends Record<string, IContextSchema>>(
	schema: IInputSchema<S>,
	player: Player,
	options?: IForPlayerOptions,
): ServerInputHandle<S> {
	const playerFolderName = options?.PlayerFolderName ?? DEFAULT_PLAYER_FOLDER_NAME;
	const timeout = options?.Timeout ?? DEFAULT_TIMEOUT;
	const deadline = os.clock() + timeout;
	const contexts = ServerAuthorityContexts(schema.Contexts);
	const names = contexts.map(([name]) => name);

	const playerFolder = WaitForChildren(player, [playerFolderName], deadline).get(playerFolderName);
	const found =
		playerFolder !== undefined
			? WaitForChildren(playerFolder, names, deadline)
			: new Map<string, Instance>();
	const missing = names.filter((name) => !found.has(name));
	if (missing.size() > 0) {
		missing.sort();
		error(
			`InputActions.ForPlayer: ${player.Name}.${playerFolderName} has no ${missing.join(", ")} after ${timeout} s. ` +
				"Call InputActions.ProvideToPlayers first",
			2,
		);
	}

	const handle: Record<string, unknown> = {};
	for (const [name, contextSchema] of contexts) {
		const context = FindContext(playerFolder!, name, name)!;
		const actions: Record<string, ServerActionHandle> = {};
		for (const [actionName, definition] of Entries(contextSchema.Actions)) {
			const path = JoinPath(name, actionName);
			const action = FindAction(context, actionName, definition.Type, path);
			if (action === undefined)
				error(`InputActions.ForPlayer: ${player.Name}.${playerFolderName}.${path} is missing`, 2);
			CheckActionType(action, definition.Type, path);
			actions[actionName] = new ServerActionHandle(action);
		}
		handle[name] = { Instance: context, Name: name, Actions: actions };
	}
	return handle as ServerInputHandle<S>;
}
