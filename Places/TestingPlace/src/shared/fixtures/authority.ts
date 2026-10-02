import { getProject } from "@flamework-experimental/testing";
import { isKnownProject } from "./projects";

/**
 * What `InputActions.IsServerAuthority()` should answer under the project this place was made under:
 * only `authority` runs Server Authority. `undefined` in a place `flamework-test` did not make.
 */
export function expectedServerAuthority(): boolean | undefined {
	const project = getProject();
	if (project === "authority") return true;
	if (isKnownProject()) return false;
	return undefined;
}

/** The warning `Create` and `ProvideToPlayers` give for marked contexts in a place without Server Authority */
export function isModeWarning(message: string) {
	return message.find("doesn't run Server Authority", 1, true)[0] !== undefined;
}

/** The warning `Create` gives after `Timeout` without the server's copy */
export function isTimeoutWarning(message: string) {
	return message.find("has not arrived", 1, true)[0] !== undefined;
}

/** Whether `message` names `text` */
export function names(message: string, text: string) {
	return message.find(text, 1, true)[0] !== undefined;
}
