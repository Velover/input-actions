import { OnStart, Provider } from "@flamework-experimental/core";
import { Networking } from "@flamework-experimental/networking";
import { defineTests, expectEqual, test } from "@flamework-experimental/testing";
import { throttle, throttleFunction } from "server/middleware/throttle";

// What the chain passes a middleware about its event; the throttle doesn't read it.
const info = { name: "test", globalName: "test", eventType: "Event" } as const;

/** Players are only keys to the throttle, so any instance can stand in for one. */
function standIn() {
	return new Instance("Folder") as unknown as Player;
}

/** A middleware on its own: call the factory with a spy for the rest of the chain. */
@Provider({ activeIn: ["testing"] })
export class ThrottleTests implements OnStart {
	onStart() {
		defineTests("throttle", () => {
			test("throttle passes one event per player per window", () => {
				let calls = 0;
				const handle = throttle(0.2)(() => {
					calls += 1;
				}, info);
				const a = standIn();
				const b = standIn();

				handle(a);
				handle(a);
				handle(b);
				expectEqual(calls, 2, "calls within the window");

				task.wait(0.25);
				handle(a);
				expectEqual(calls, 3, "calls after the window");
			});

			test("throttleFunction answers a dropped call with Skip", () => {
				const handle = throttleFunction<[], number>(0.2)(() => 42, info);
				const player = standIn();

				expectEqual(handle(player), 42);
				expectEqual(handle(player), Networking.Skip);
			});
		});
	}
}
