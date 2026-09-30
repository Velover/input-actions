import { RunService } from "@rbxts/services";

/**
 * Runs `callback` once per frame: at a render step (`BindToRenderStep` with `name` and `priority`,
 * or `RenderStepped` without them). A client that renders nothing, such as a Studio window that
 * isn't drawn, fires no render step at all; in those frames `callback` runs on Heartbeat instead.
 * Returns a function that stops it.
 */
export function EveryFrame(
	callback: (deltaTime: number) => void,
	name?: string,
	priority?: number,
): () => void {
	let rendered = false;
	const OnRender = (deltaTime: number) => {
		rendered = true;
		callback(deltaTime);
	};
	let renderConnection: RBXScriptConnection | undefined;
	if (name !== undefined && priority !== undefined)
		RunService.BindToRenderStep(name, priority, OnRender);
	else renderConnection = RunService.RenderStepped.Connect(OnRender);

	const fallback = RunService.Heartbeat.Connect((deltaTime) => {
		if (rendered) rendered = false;
		else callback(deltaTime);
	});
	return () => {
		if (renderConnection !== undefined) renderConnection.Disconnect();
		else RunService.UnbindFromRenderStep(name!);
		fallback.Disconnect();
	};
}
