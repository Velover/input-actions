/**
 * The virtual-pad service (`tools/virtual-pad`), which `bun run test` starts for a run
 * (`scripts/virtual-pad.mjs`): a virtual Xbox 360 pad plugged into Windows through the ViGEmBus
 * driver, driven over HTTP on 127.0.0.1, and (experimental) Windows touch injection. HttpService
 * works on the server only, so the server's host (`src/server/tests/virtual-pad.ts`) forwards the
 * client's calls (`src/client/tests/virtual-pad.ts`) through a RemoteFunction.
 */
export const VIRTUAL_PAD_PORT = 47110;
export const VIRTUAL_PAD_REMOTE = "InputActionsVirtualPad";

/** The paths the host forwards: the service's API (`tools/virtual-pad/src/main.rs`) but `/quit` */
export const VIRTUAL_PAD_PATHS = [
	"/health",
	"/connect",
	"/disconnect",
	"/state",
	"/reset",
	"/touch",
	"/touch/init",
	"/touch/reset",
	"/window",
	"/window/release",
] as const;
export type VirtualPadPath = (typeof VIRTUAL_PAD_PATHS)[number];
export type VirtualPadMethod = "GET" | "POST";

/** What the host answers: the service's reply, or why there is none */
export interface VirtualPadReply {
	/** Whether the service answered with a 2xx status */
	Ok: boolean;
	/** The HTTP status, when the service answered */
	Status?: number;
	/** The JSON body, decoded */
	Body?: unknown;
	/** Why the call failed: the request's error, or the status and the service's `error` */
	Error?: string;
}

/** The pad's whole state, as `POST /state` takes it: triggers 0..1, stick axes -1..1 with y up */
export interface VirtualPadState {
	buttons: string[];
	leftTrigger: number;
	rightTrigger: number;
	leftStick: [number, number];
	rightStick: [number, number];
}
