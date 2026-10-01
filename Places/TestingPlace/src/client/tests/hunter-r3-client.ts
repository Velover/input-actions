import { OnStart, Provider } from "@flamework-experimental/core";
import { defer, defineTests, expectTrue, test } from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";
import { newFolder, nearlyEqual } from "./helpers";

const K = Enum.KeyCode;

/** A trigger whose defaults put ReleasedThreshold (0.6) under a raised PressedThreshold (0.9) */
const TRIGGER_SCHEMA = InputActions.Schema({
	HunterTrigger: {
		Actions: {
			Fire: InputActions.Bool({
				Pad: { KeyCode: K.ButtonR2, PressedThreshold: 0.9, ReleasedThreshold: 0.6 },
			}),
		},
	},
});

type TriggerInput = InputActions.Handle<typeof TRIGGER_SCHEMA.Contexts>;

function createTrigger(folder: Instance = newFolder()): TriggerInput {
	const input = InputActions.Create(TRIGGER_SCHEMA, { Folder: folder });
	defer(() => input.Destroy());
	return input;
}

/**
 * A player's settings change: ReleasedThreshold raised to 0.8, then PressedThreshold lowered to
 * 0.6. IAS keeps the stored 0.8 and reads it as 0.6 (at most PressedThreshold, probed)
 */
function tuneDown(pad: InputActions.BindingHandle<Enum.InputActionType.Bool>) {
	pad.Set({ KeyCode: K.ButtonR2, ReleasedThreshold: 0.8 });
	pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.6 });
}

function reads(binding: InputBinding) {
	return `PressedThreshold ${binding.PressedThreshold}, ReleasedThreshold ${binding.ReleasedThreshold}`;
}

/** Whether the binding reads the trigger's defaults: 0.9 and 0.6 */
function atDefaults(binding: InputBinding) {
	return (
		nearlyEqual(binding.PressedThreshold, 0.9, 1e-3) &&
		nearlyEqual(binding.ReleasedThreshold, 0.6, 1e-3)
	);
}

/**
 * Hunt round 3: the package without real input. Writing bindings compares each value with the
 * binding as it read before the write (design spec §6, "Writing bindings"). A raised
 * PressedThreshold brings a stored ReleasedThreshold back into view during the write, so a
 * ReleasedThreshold whose target equals the clamped reading from before is never written.
 */
@Provider({ activeIn: ["testing"] })
export class HunterR3ClientTests implements OnStart {
	onStart() {
		defineTests("hunter-r3", () => {
			test("thresholds: Reset brings the defaults back after ReleasedThreshold was raised and PressedThreshold lowered", () => {
				const input = createTrigger();
				const pad = input.HunterTrigger.Actions.Fire.Bindings.Pad;
				expectTrue(atDefaults(pad.Instance), `the defaults: ${reads(pad.Instance)}`);
				tuneDown(pad);
				const tuned = reads(pad.Instance);
				pad.Reset();
				expectTrue(
					atDefaults(pad.Instance),
					`after Reset: ${reads(pad.Instance)} (before it: ${tuned}); the defaults are 0.9 and 0.6`,
				);
				const save = input.ExportBindings();
				expectTrue(
					save.find("HunterTrigger/Fire/Pad", 1, true)[0] === undefined,
					`the export after Reset holds no change: ${save}`,
				);
			});

			test("thresholds: ResetBindings and an import of an empty save bring the defaults back too", () => {
				const input = createTrigger();
				const pad = input.HunterTrigger.Actions.Fire.Bindings.Pad;
				tuneDown(pad);
				input.ResetBindings();
				const afterResetBindings = reads(pad.Instance);
				tuneDown(pad);
				input.ImportBindings('{"Version":1,"Bindings":{}}');
				expectTrue(
					atDefaults(pad.Instance),
					`after ResetBindings: ${afterResetBindings}; after importing an empty save: ${reads(pad.Instance)}`,
				);
			});

			test("thresholds: Set with both thresholds gives the binding what the spec says", () => {
				const pad = createTrigger().HunterTrigger.Actions.Fire.Bindings.Pad;
				tuneDown(pad);
				pad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.9, ReleasedThreshold: 0.6 });
				const got = pad.Get() as { ReleasedThreshold?: number };
				expectTrue(
					atDefaults(pad.Instance),
					`Set({ PressedThreshold: 0.9, ReleasedThreshold: 0.6 }) reads ${reads(pad.Instance)}; Get() says ReleasedThreshold ${got.ReleasedThreshold}`,
				);
			});

			test("thresholds: an export imported into a handle whose binding was tuned reads as exported", () => {
				const source = createTrigger();
				const exported = source.ExportBindings();
				const input = createTrigger();
				const pad = input.HunterTrigger.Actions.Fire.Bindings.Pad;
				tuneDown(pad);
				// A save of other values: the target is the defaults plus a changed PressedThreshold
				const sourcePad = source.HunterTrigger.Actions.Fire.Bindings.Pad;
				sourcePad.Set({ KeyCode: K.ButtonR2, PressedThreshold: 0.95 });
				const save = source.ExportBindings();
				const result = input.ImportBindings(save);
				expectTrue(
					nearlyEqual(pad.Instance.ReleasedThreshold, sourcePad.Instance.ReleasedThreshold, 1e-3),
					`imported ${save} (applied ${result.Applied.join(", ")}): the source reads ${reads(sourcePad.Instance)}, the target ${reads(pad.Instance)}; an export of the defaults is ${exported}`,
				);
			});

			test("thresholds: Destroy gives an adopted binding its defaults back, so a later Create starts from them", () => {
				const folder = newFolder();
				const context = new Instance("InputContext");
				context.Name = "HunterTrigger";
				const action = new Instance("InputAction");
				action.Name = "Fire";
				const binding = new Instance("InputBinding");
				binding.Name = "FirePad";
				binding.KeyCode = K.ButtonR2;
				binding.PressedThreshold = 0.9;
				binding.ReleasedThreshold = 0.6;
				binding.Parent = action;
				action.Parent = context;
				context.Parent = folder;

				const first = InputActions.Create(TRIGGER_SCHEMA, { Folder: folder });
				tuneDown(first.HunterTrigger.Actions.Fire.Bindings.Pad);
				first.Destroy();
				expectTrue(
					atDefaults(binding),
					`the designer's binding after Destroy: ${reads(binding)}; it was 0.9 and 0.6`,
				);
			});
		});
	}
}
