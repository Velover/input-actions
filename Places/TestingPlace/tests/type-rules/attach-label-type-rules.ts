// AttachLabel and WhenLinkedToServer (0.6.1): which handles have them, and their types. Checked by
// plain tsc; each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;

const LABELS = InputActions.Schema({
	Play: {
		ServerAuthority: true,
		Actions: {
			Jump: InputActions.Bool({ Keys: K.Space }),
			Move: InputActions.Direction2D({ Keys: { Up: K.W, Down: K.S, Left: K.A, Right: K.D } }),
			Aim: InputActions.ViewportPosition({ Pointer: K.MousePosition }),
		},
	},
	Menu: { Actions: { Open: InputActions.Bool({ Keys: K.M }) } },
});

export function AttachLabelTypeRules() {
	const Input = InputActions.Create(LABELS);
	const { Jump, Move, Aim } = Input.Play.Actions;
	const label = new Instance("InputActionLabel");

	// ---- what must compile, with the types it must have
	const detachJump: () => void = Jump.AttachLabel(label);
	Move.AttachLabel(label);
	Aim.AttachLabel(label);
	Input.Menu.Actions.Open.AttachLabel(label);
	const cancel: () => void = Input.Play.WhenLinkedToServer((context) => {
		const copy: InputContext = context;
		return copy;
	});
	const anyAction = (action: InputActions.Action<Enum.InputActionType>) =>
		action.AttachLabel(label);
	anyAction(Move);

	// ---- what must not compile
	// @ts-expect-error a context without ServerAuthority has no WhenLinkedToServer
	Input.Menu.WhenLinkedToServer(() => {});
	// @ts-expect-error AttachLabel takes an InputActionLabel, not a TextLabel
	Jump.AttachLabel(new Instance("TextLabel"));
	// @ts-expect-error the callback gets the server's InputContext, not a string
	Input.Play.WhenLinkedToServer((context: string) => context);

	return [detachJump, cancel];
}
