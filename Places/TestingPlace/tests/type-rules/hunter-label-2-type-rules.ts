// Hunt round 2 (labels): the internals the round 1 fixes added to the handle classes
// (`ReleaseLabel`, `MarkLinked`, `NotifyLinked`, `Attach`) stay off the public types. Checked by
// plain tsc; each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const HL2 = InputActions.Schema({
	Play: { ServerAuthority: true, Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }) } },
	Menu: { Actions: { Open: InputActions.Bool({ KeyboardAndMouse: K.M }) } },
});

export function HunterLabel2TypeRules() {
	const Input = InputActions.Create(HL2);
	const label = new Instance("InputActionLabel");
	const jump = Input.Play.Actions.Jump;

	// ---- what must compile
	const detach: () => void = jump.AttachLabel(label);
	const linked: boolean = Input.Play.IsLinkedToServer();

	// ---- what must not compile
	// @ts-expect-error ReleaseLabel is internal (LABEL_OWNERS)
	jump.ReleaseLabel(label);
	// @ts-expect-error DetachLabel is internal: the function AttachLabel returns lets go
	jump.DetachLabel(label);
	// @ts-expect-error Attach is internal (the Server Authority swap)
	jump.Attach(jump.Instance);
	// @ts-expect-error MarkLinked is internal (the swap)
	Input.Play.MarkLinked();
	// @ts-expect-error NotifyLinked is internal (the swap)
	Input.Play.NotifyLinked();
	// @ts-expect-error a context without ServerAuthority has no IsLinkedToServer
	Input.Menu.IsLinkedToServer();
	// @ts-expect-error AttachLabel's function takes no argument
	detach(label);

	return [detach, linked];
}
