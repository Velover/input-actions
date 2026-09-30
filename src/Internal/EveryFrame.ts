import { RunService } from "@rbxts/services";

/**
 * Runs `callback` once per frame, before the frame's Heartbeat: at a render step
 * (`BindToRenderStep` with `name` and `priority`, or `RenderStepped` without them). A client that
 * renders nothing, such as a Studio window that isn't drawn, fires no render step; in those frames
 * `callback` runs on `PreAnimation` instead, which comes after rendering and before the simulation.
 * A frame ends at Heartbeat, so a window whose render steps don't line up with its frames still
 * gets one call per frame. Returns a function that stops it.
 */
export function EveryFrame(
	callback: (deltaTime: number) => void,
	name?: string,
	priority?: number,
): () => void {
	// Whether this frame's call happened
	let ran = false;
	const Run = (deltaTime: number) => {
		if (ran) return;
		ran = true;
		callback(deltaTime);
	};
	let renderConnection: RBXScriptConnection | undefined;
	if (name !== undefined && priority !== undefined) RunService.BindToRenderStep(name, priority, Run);
	else renderConnection = RunService.RenderStepped.Connect(Run);

	const fallback = RunService.PreAnimation.Connect(Run);
	const frameEnd = RunService.Heartbeat.Connect(() => {
		ran = false;
	});
	return () => {
		if (renderConnection !== undefined) renderConnection.Disconnect();
		else RunService.UnbindFromRenderStep(name!);
		fallback.Disconnect();
		frameEnd.Disconnect();
	};
}
