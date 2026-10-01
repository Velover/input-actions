import { Workspace } from "@rbxts/services";
import type { IContextSchema } from "./Types";

// Whether the place runs Server Authority (design spec §8). `Workspace.AuthorityMode` can't be read
// by scripts (probed), but `Terrain:CanSetNetworkOwnership()` answers `(false, reason)`, and the
// reason depends on the mode (probed 2026-10-01, game scripts, both realms):
//
// - under Server Authority, on either realm: "Can not call Network Ownership API when
//   workspace.AuthorityMode = Enums.AuthorityMode.Server."
// - otherwise, on the client: "Network Ownership API can only be called from the Server."
// - otherwise, on the server: "Network Ownership API cannot be used on Terrain"
//
// A reason never seen before (Roblox reworded it) gives `undefined`, so the warnings go quiet
// rather than wrong.

/** What the reason mentions under Server Authority */
const SERVER_AUTHORITY_MARK = "AuthorityMode";

/** The reasons seen without Server Authority: on the client, and on the server */
const OTHER_MODE_REASONS: readonly string[] = [
	"Network Ownership API can only be called from the Server.",
	"Network Ownership API cannot be used on Terrain",
];

/** The first answer that was not `undefined`: the mode can't change during a session */
let known: boolean | undefined;

/** Reads the mode from the engine's message; `undefined` when the message says nothing known */
function ReadAuthorityMode(): boolean | undefined {
	const [allowed, reason] = Workspace.Terrain.CanSetNetworkOwnership();
	if (allowed !== false || !typeIs(reason, "string")) return undefined;
	if (reason.find(SERVER_AUTHORITY_MARK, 1, true)[0] !== undefined) return true;
	if (OTHER_MODE_REASONS.includes(reason)) return false;
	return undefined;
}

/**
 * Best-effort: whether the place runs Server Authority (`Workspace.AuthorityMode = Server`), read
 * from the reason `Terrain:CanSetNetworkOwnership()` gives. `undefined` when the answer is not one
 * the package knows (the call succeeded, threw, or Roblox reworded the message). The first `true`
 * or `false` is kept for the session. Never throws.
 */
export function IsServerAuthority(): boolean | undefined {
	if (known !== undefined) return known;
	const [ok, mode] = pcall(ReadAuthorityMode);
	if (!ok || mode === undefined) return undefined;
	known = mode;
	return mode;
}

/**
 * Warns once when the schema marks contexts `ServerAuthority: true` in a place that doesn't run
 * Server Authority: their state never reaches the server. Silent when the mode is unknown.
 */
export function WarnIfNotServerAuthority(caller: string, contexts: Record<string, IContextSchema>) {
	const marked = new Array<string>();
	for (const [name, schema] of pairs(contexts)) {
		if (schema.ServerAuthority === true) marked.push(name as string);
	}
	if (marked.size() === 0 || IsServerAuthority() !== false) return;
	marked.sort();
	warn(
		`${caller}: ${marked.join(", ")} ${marked.size() === 1 ? "is" : "are"} marked ServerAuthority: true, ` +
			"but this place doesn't run Server Authority (Workspace.AuthorityMode is not Server), so the " +
			"server will never receive their state. They still work on the client. Turn Server Authority " +
			"on in the Workspace settings, or drop ServerAuthority: true from the schema",
	);
}
