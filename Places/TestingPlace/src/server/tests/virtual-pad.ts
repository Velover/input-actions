import { OnStart, Provider } from "@flamework-experimental/core";
import { HttpService, ReplicatedStorage } from "@rbxts/services";
import {
	VIRTUAL_PAD_PATHS,
	VIRTUAL_PAD_PORT,
	VIRTUAL_PAD_REMOTE,
	VirtualPadMethod,
	VirtualPadPath,
	VirtualPadReply,
} from "shared/fixtures/virtual-pad";

/**
 * Calls the virtual-pad service on this machine (`tools/virtual-pad`). A POST without a body sends
 * `{}`: JSONEncode makes an empty table `[]`.
 */
export function callVirtualPad(
	method: VirtualPadMethod,
	path: VirtualPadPath,
	body?: object,
): VirtualPadReply {
	const post = method === "POST";
	const [sent, response] = pcall(() =>
		HttpService.RequestAsync({
			Url: `http://127.0.0.1:${VIRTUAL_PAD_PORT}${path}`,
			Method: method,
			Headers: post ? { "Content-Type": "application/json" } : undefined,
			Body: post ? (body === undefined ? "{}" : HttpService.JSONEncode(body)) : undefined,
		}),
	);
	if (!sent) return { Ok: false, Error: tostring(response) };
	const [decoded, value] = pcall(() => HttpService.JSONDecode(response.Body));
	const parsed: unknown = decoded ? value : undefined;
	if (response.Success) return { Ok: true, Status: response.StatusCode, Body: parsed };
	const reason = typeIs(parsed, "table") ? (parsed as { error?: unknown }).error : undefined;
	return {
		Ok: false,
		Status: response.StatusCode,
		Body: parsed,
		Error: `${response.StatusCode} ${typeIs(reason, "string") ? reason : response.Body}`,
	};
}

/**
 * The server's side of the client's virtual pad (`src/client/tests/virtual-pad.ts`): the client
 * can't use HttpService, so `ReplicatedStorage.InputActionsVirtualPad` forwards its calls to the
 * service, to the API's paths only. When the play session ends, the pad is unplugged, every touch
 * contact lifted and the window kept on top let go, in case a test died before its cleanup.
 */
@Provider({ activeIn: ["testing"] })
export class VirtualPadHost implements OnStart {
	onStart() {
		const paths = new Set<string>(VIRTUAL_PAD_PATHS);
		const remote = new Instance("RemoteFunction");
		remote.Name = VIRTUAL_PAD_REMOTE;
		remote.OnServerInvoke = (_player, method, path, body) => {
			if (method !== "GET" && method !== "POST")
				return { Ok: false, Error: `bad method ${method}` };
			if (!typeIs(path, "string") || !paths.has(path))
				return { Ok: false, Error: `bad path ${path}` };
			if (body !== undefined && !typeIs(body, "table")) return { Ok: false, Error: "bad body" };
			return callVirtualPad(method, path as VirtualPadPath, body as object | undefined);
		};
		remote.Parent = ReplicatedStorage;

		game.BindToClose(() => {
			callVirtualPad("POST", "/touch/reset");
			callVirtualPad("POST", "/disconnect");
			callVirtualPad("POST", "/window/release");
		});
	}
}
