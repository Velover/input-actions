import { OnStart, Provider } from "@flamework-experimental/core";
import {
	defer,
	defineTests,
	expectEqual,
	expectFalse,
	expectTrue,
	test,
} from "@flamework-experimental/testing";
import { InputCatcher } from "@rbxts/input-actions";
import { ContextActionService } from "@rbxts/services";

function boundActionCount() {
	let count = 0;
	for (const _ of pairs(ContextActionService.GetAllBoundActionInfo())) count++;
	return count;
}

/** InputCatcher: a ContextActionService sink over every input (design spec §10) */
@Provider({ activeIn: ["testing"] })
export class InputCatcherTests implements OnStart {
	onStart() {
		defineTests("input-catcher", () => {
			test("GrabInput binds one sinking CAS action; ReleaseInput unbinds it", () => {
				const catcher = new InputCatcher(5000);
				defer(() => catcher.ReleaseInput());
				const before = boundActionCount();
				expectFalse(catcher.IsActive());
				catcher.GrabInput();
				expectTrue(catcher.IsActive());
				expectEqual(boundActionCount(), before + 1);
				catcher.ReleaseInput();
				expectFalse(catcher.IsActive());
				expectEqual(boundActionCount(), before);
			});
		});
	}
}
