import { getProject } from "@flamework-experimental/testing";

/**
 * What each Rojo project the tests run under sets on Workspace (`default.project.json`,
 * `tests/<name>.project.json`), for the tests that depend on it: no script can read
 * `Workspace.SignalBehavior` or `AuthorityMode`. `getProject()` is undefined in a place
 * `flamework-test` did not make.
 */
const PROJECTS: Record<string, { IasPlayerScripts: boolean; Signals: "Immediate" | "Deferred" }> = {
	default: { IasPlayerScripts: false, Signals: "Deferred" },
	ias: { IasPlayerScripts: true, Signals: "Deferred" },
	authority: { IasPlayerScripts: true, Signals: "Deferred" },
	touch: { IasPlayerScripts: true, Signals: "Deferred" },
	immediate: { IasPlayerScripts: false, Signals: "Immediate" },
	"ias-immediate": { IasPlayerScripts: true, Signals: "Immediate" },
};

/** Whether this place was made under one of the projects above */
export function isKnownProject() {
	const project = getProject();
	return project !== undefined && PROJECTS[project] !== undefined;
}

/** Whether the IAS player scripts run (`PlayerScriptsUseInputActionSystem`); false in an unknown place */
export function usesIasPlayerScripts() {
	const project = getProject();
	return project !== undefined && PROJECTS[project]?.IasPlayerScripts === true;
}

/** Whether the legacy player scripts run; false in an unknown place */
export function usesLegacyPlayerScripts() {
	const project = getProject();
	return project !== undefined && PROJECTS[project]?.IasPlayerScripts === false;
}

/**
 * The `SignalBehavior` the project sets. `tests/place.rbxlx` is Deferred, and Server Authority
 * requires Deferred, so only `immediate` and `ias-immediate` run Immediate.
 */
export function expectedSignalBehavior(): "Immediate" | "Deferred" | undefined {
	const project = getProject();
	return project !== undefined ? PROJECTS[project]?.Signals : undefined;
}
