import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defineTests,
	expectEqual,
	expectFalse,
	expectThrows,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { createTestInput, frame } from "./helpers";

// One snapshot per frame. Whether a test thread resumed by `frame()` runs before or after that
// frame's snapshot is up to the scheduler, so these tests record a few frames of readings and check
// the pattern: a change shows in exactly one frame, with the old value as the previous one.

interface IReading<T> {
	State: T;
	Previous: T;
	Changed: boolean;
	JustPressed: boolean;
	JustReleased: boolean;
}

function record<T>(count: number, read: () => IReading<T>): IReading<T>[] {
	const readings = new Array<IReading<T>>();
	for (let index = 0; index < count; index++) {
		frame();
		readings.push(read());
	}
	return readings;
}

/** TrackPrevious: one snapshot per frame (design spec §6) */
@Provider({ activeIn: ["testing"] })
export class TrackPreviousTests implements OnStart {
	onStart() {
		defineTests("track-previous", () => {
			test("GetPrevious and HasChanged follow the per-frame snapshots", () => {
				const steer = createTestInput().Gameplay.Actions.Steer;
				frame();
				expectEqual(steer.GetPrevious(), 0);
				expectFalse(steer.HasChanged());
				steer.Fire(0.5);
				// GetState is live; the snapshot reads still agree with the last snapshot
				expectEqual(steer.GetState(), 0.5);
				expectEqual(steer.GetPrevious(), 0);
				expectFalse(steer.HasChanged());

				const readings = record(4, () => ({
					State: steer.GetState(),
					Previous: steer.GetPrevious(),
					Changed: steer.HasChanged(),
					JustPressed: false,
					JustReleased: false,
				}));
				const changed = readings.filter((reading) => reading.Changed);
				expectEqual(changed.size(), 1, "frames with HasChanged");
				expectEqual(changed[0].Previous, 0);
				expectEqual(readings[readings.size() - 1].Previous, 0.5);
				expectFalse(readings[readings.size() - 1].Changed);
			});

			test("IsJustPressed and IsJustReleased last one frame", () => {
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				const read = () => ({
					State: crouch.GetState(),
					Previous: crouch.GetPrevious(),
					Changed: crouch.HasChanged(),
					JustPressed: crouch.IsJustPressed(),
					JustReleased: crouch.IsJustReleased(),
				});
				frame();
				crouch.Fire(true);
				const pressing = record(4, read);
				const pressed = pressing.filter((reading) => reading.JustPressed);
				expectEqual(pressed.size(), 1, "frames with IsJustPressed");
				expectFalse(pressed[0].Previous);
				expectTrue(pressed[0].Changed);
				expectFalse(pressing.some((reading) => reading.JustReleased));
				expectTrue(pressing[pressing.size() - 1].Previous);

				crouch.Fire(false);
				const releasing = record(4, read);
				expectEqual(
					releasing.filter((reading) => reading.JustReleased).size(),
					1,
					"frames with IsJustReleased",
				);
				expectFalse(releasing.some((reading) => reading.JustPressed));
			});

			test("a press and release within one frame counts as both", () => {
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				frame();
				crouch.Fire(true);
				crouch.Fire(false);
				expectFalse(crouch.GetState());
				const readings = record(4, () => ({
					State: crouch.GetState(),
					Previous: crouch.GetPrevious(),
					Changed: crouch.HasChanged(),
					JustPressed: crouch.IsJustPressed(),
					JustReleased: crouch.IsJustReleased(),
				}));
				const tapped = readings.filter((reading) => reading.JustPressed && reading.JustReleased);
				expectEqual(tapped.size(), 1, "frames with both");
				expectTrue(tapped[0].Changed);
				expectFalse(tapped[0].Previous);
				expectEqual(
					readings.filter((reading) => reading.JustPressed || reading.JustReleased).size(),
					1,
				);
				expectFalse(readings.some((reading) => reading.State));
			});

			test("a press is counted once", () => {
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				frame();
				crouch.Fire(true);
				let pressedFrames = 0;
				for (let index = 0; index < 5; index++) {
					frame();
					if (crouch.IsJustPressed()) pressedFrames++;
				}
				expectEqual(pressedFrames, 1);
			});

			test("Tap is just pressed, then just released", () => {
				const crouch = createTestInput().Gameplay.Actions.Crouch;
				frame();
				crouch.Tap();
				let pressedFrames = 0;
				let releasedFrames = 0;
				for (let index = 0; index < 5; index++) {
					frame();
					if (crouch.IsJustPressed()) pressedFrames++;
					if (crouch.IsJustReleased()) releasedFrames++;
				}
				expectEqual(pressedFrames, 1);
				expectEqual(releasedFrames, 1);
				expectFalse(crouch.GetState());
			});

			test("actions without TrackPrevious have no snapshot methods at runtime", () => {
				const jump = createTestInput().Gameplay.Actions.Jump as unknown as {
					GetPrevious(): unknown;
				};
				expectThrows(() => jump.GetPrevious());
			});
		});
	}
}
