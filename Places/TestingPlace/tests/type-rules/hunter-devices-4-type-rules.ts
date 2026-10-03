// Hunter round 4 on device bindings (0.7.0): typing probes on the ways a project passes a schema
// around (Create's checked parameter, hunt HD3-2) and on Set's parts (HD3-3). Checked by plain tsc;
// each rule stays on the one line after its directive.
import { InputActions } from "@rbxts/input-actions";

const K = Enum.KeyCode;
type BoolType = Enum.InputActionType.Bool;
type Dir2DType = Enum.InputActionType.Direction2D;

declare const player: Player;

const PLAY = InputActions.Schema({
	Hd4Play: {
		ServerAuthority: true,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space, Gamepad: K.ButtonA }) },
	},
});
const MENU = InputActions.Schema({
	Hd4Menu: { Priority: 3000, Actions: { Open: InputActions.Bool({ KeyboardAndMouse: K.M }) } },
});

// ---- a helper generic over the schema, on the server

// HD4-2 (hunter, fixed: ForPlayer, ProvideToPlayers and SanitizeBindings take the schema as Create does, Schema's result first, then ICheckedInputSchema<S>; and ICheckedInputSchema<S> is an interface, IInputSchema<S> with Contexts: S & CheckContexts<S>, so from InputSchema<S> to a parameter of that type S is inferred as it is: from the intersection it was S & CheckContexts<S>, through Create too, where InputHandle<S> happened to take it): a helper generic over InputActions.InputSchema<S> can't hand back ForPlayer's handles as InputActions.ServerHandle<S>. InputSchema<S> is CheckedInputSchema<S> since round 3 (IInputSchema<S> & { Contexts: CheckContexts<S> }), and ForPlayer's parameter is still IInputSchema<S>, so its S is inferred as S & CheckContexts<S>: TS2322 "Type 'ServerInputHandle<S & CheckContexts<S>>' is not assignable to type 'ServerInputHandle<S>'" (tsc 5.5.3). In 0.6 (InputSchema<S> = IInputSchema<S>) the same helper compiled. API.md (Types): "InputSchema<S> ... a helper generic over it can pass it to Create"; design spec §4: "a helper generic over the schema must take the checked type to pass it on, and then does"
export function serverHandles<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	who: Player,
): InputActions.ServerHandle<S> {
	return InputActions.ForPlayer(schema, who);
}

/** worker, HD4-2: the same on the client, and every function through one helper */
export function clientHandles<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	who: Player,
): [InputActions.Handle<S>, InputActions.ServerHandle<S>, string, () => void] {
	return [
		InputActions.Create(schema),
		InputActions.ForPlayer(schema, who, { Timeout: 5 }),
		InputActions.SanitizeBindings(schema, "{}"),
		InputActions.ProvideToPlayers(schema, { PlayerFolderName: "Inputs" }),
	];
}

/** The same helper with ForPlayer's type argument written out: compiles (the workaround) */
export function serverHandlesExplicit<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	who: Player,
): InputActions.ServerHandle<S> {
	return InputActions.ForPlayer<S>(schema, who);
}

/** A helper generic over the schema that provides it and cleans saves: compiles */
export function serve<S extends Record<string, InputActions.ContextSchema>>(
	schema: InputActions.InputSchema<S>,
	json: string,
) {
	InputActions.ProvideToPlayers(schema);
	return InputActions.SanitizeBindings(schema, json);
}

// ---- what must compile: the ways a project passes schemas around

export function HunterDevices4SchemaRules() {
	// contexts spread from two schemas, written without Schema, and through Schema
	const both = InputActions.Create({ Contexts: { ...PLAY.Contexts, ...MENU.Contexts } });
	both.Hd4Play.Actions.Jump.Pressed.Connect(() => {});
	both.Hd4Menu.Actions.Open.Pressed.Connect(() => {});
	both.Hd4Play.IsLinkedToServer();
	const server = InputActions.ForPlayer({ Contexts: { ...PLAY.Contexts, ...MENU.Contexts } }, player);
	server.Hd4Play.Actions.Jump.Released.Connect(() => {});
	InputActions.Create(InputActions.Schema({ ...PLAY.Contexts, ...MENU.Contexts }));
	// a preset merged into a context, with an action of its own, the schema kept in a variable
	const uiSchema = InputActions.Schema({
		Ui: { ...InputActions.Presets.UiNavigation(), Priority: 5 },
		Ui2: {
			...InputActions.Presets.UiNavigation({ Sink: true }),
			Actions: {
				...InputActions.Presets.UiNavigation().Actions,
				Extra: InputActions.Bool({ KeyboardAndMouse: K.X }),
			},
		},
	});
	const ui = InputActions.Create(uiSchema);
	ui.Ui2.Actions.Extra.Pressed.Connect(() => {});
	ui.Ui2.Actions.Accept.Pressed.Connect(() => {});
	// the preset given options, inside Create: compiles
	InputActions.Create(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation({ Priority: 3000 }) }));
	// written without Schema: compiles
	InputActions.Create({ Contexts: { Ui: InputActions.Presets.UiNavigation() } });
	// a schema kept in a variable typed as the exported type, given to every function
	const typed: InputActions.InputSchema<typeof PLAY.Contexts> = PLAY;
	const handle: InputActions.Handle<typeof PLAY.Contexts> = InputActions.Create(typed);
	const serverHandle: InputActions.ServerHandle<typeof PLAY.Contexts> = InputActions.ForPlayer(
		typed,
		player,
	);
	InputActions.ProvideToPlayers(typed);
	InputActions.SanitizeBindings(typed, "{}");
	// an `as const` schema written without Schema
	const raw = {
		Contexts: { Raw: { Sink: true, Actions: { Go: InputActions.Bool({ Gamepad: K.ButtonX }) } } },
	} as const;
	InputActions.Create(raw).Raw.Actions.Go.Pressed.Connect(() => {});
	InputActions.SanitizeBindings(raw, "{}");
	// a context typed as ContextSchema
	const context: InputActions.ContextSchema = {
		Priority: 5,
		Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.J }) },
	};
	InputActions.Create({ Contexts: { Ctx: context } }).Ctx.Actions.Jump.GetState();
	// Advanced.md, "A menu with a column per device"
	for (const device of ["KeyboardAndMouse", "Gamepad"] as const) {
		const binding = handle.Hd4Play.Actions.Jump.Bindings[device];
		print(device, binding.Get().KeyCode);
	}
	handle.Hd4Play.Actions.Jump.Bindings[InputActions.PreferredDevice()].Get();
	return [serverHandle, both];
}

// ---- the preset inside Create(Schema(...))

// HD4-3 (hunter, fixed: Schema returns ISchema<S>, IInputSchema<S> branded, and Create, ForPlayer, ProvideToPlayers and SanitizeBindings each have two overloads, ISchema<S> first, ICheckedInputSchema<S> second: a Schema call written inside them infers from the first, which checks nothing again): Create(Schema({ ..., Ui: InputActions.Presets.UiNavigation() })), the preset without options (or spread into a context) in a Schema call written inside Create, doesn't compile. Create's parameter, CheckedInputSchema<S> since round 3, is the contextual type of the Schema call, and the preset's type parameter O, with no argument to infer it from, is inferred from that context instead: Contexts.Ui becomes "IContextSchema & { [P in Exclude<keyof S[string], keyof IContextSchema>]: never } & { [x: string]: never; ... }", TS2345 at Create's argument and TS2322 at the preset (tsc 5.5.3), an error that names nothing the user wrote. The same schema kept in a variable compiles, so do the preset given options and a 0.6-style Create(schema: { Contexts: S }) (measured: it compiles all three). API.md (Presets): "InputActions.Presets.UiNavigation(options?)"; design spec §4: "Schema's result, a preset, a schema kept in a variable ... all still compile"
export function HunterDevices4PresetRules() {
	const a = InputActions.Create(InputActions.Schema({ Gameplay: { Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }) } }, Ui: InputActions.Presets.UiNavigation() }));
	a.Ui.Actions.Accept.Pressed.Connect(() => {});
	a.Gameplay.Actions.Jump.Pressed.Connect(() => {});
	InputActions.Create(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation() }));
	InputActions.Create(InputActions.Schema({ Ui: { ...InputActions.Presets.UiNavigation(), Priority: 5 } }));
	// worker, HD4-3: the same inside the other functions that take a schema
	const server = InputActions.ForPlayer(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation({ ServerAuthority: true }), Hd4Sa: { ServerAuthority: true, Actions: { Go: InputActions.Bool({ Gamepad: K.ButtonX }) } } }), player);
	server.Ui.Actions.Accept.Pressed.Connect(() => {});
	server.Hd4Sa.Actions.Go.Released.Connect(() => {});
	InputActions.ProvideToPlayers(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation() }));
	InputActions.SanitizeBindings(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation() }), "{}");
	InputActions.SanitizeBindings(InputActions.Schema({ Ui: { ...InputActions.Presets.UiNavigation(), Sink: true } }), "{}");
	// misspelt options are still refused: in the preset's options, in Schema, and in a raw schema given to each
	// @ts-expect-error a misspelt preset option inside Create(Schema(...))
	InputActions.Create(InputActions.Schema({ Ui: InputActions.Presets.UiNavigation({ Snk: true }) }));
	// @ts-expect-error a misspelt context option inside Create(Schema(...))
	InputActions.Create(InputActions.Schema({ Ui: { ...InputActions.Presets.UiNavigation(), Priorty: 5 } }));
	const actions = { Go: InputActions.Bool({ Gamepad: K.ButtonX }) };
	// @ts-expect-error a misspelt option in a raw schema given to ForPlayer
	InputActions.ForPlayer({ Contexts: { Hd4Sa: { ServerAuthorty: true, Actions: actions } } }, player);
	// @ts-expect-error the same given to ProvideToPlayers
	InputActions.ProvideToPlayers({ Contexts: { Hd4Sa: { ServerAuthorty: true, Actions: actions } } });
	// @ts-expect-error the same given to SanitizeBindings
	InputActions.SanitizeBindings({ Contexts: { Hd4Sa: { Snk: true, Actions: actions } } }, "{}");
	const misspelt = { Contexts: { Hd4Sa: { ServerAuthorty: true, Actions: actions } } };
	// @ts-expect-error the same kept in a variable, given to ForPlayer
	InputActions.ForPlayer(misspelt, player);
	// @ts-expect-error through a helper generic over InputActions.InputSchema<S>
	serverHandles(misspelt, player);
}

// ---- what must not compile

export function HunterDevices4RefusedRules() {
	const actions = { Jump: InputActions.Bool({ KeyboardAndMouse: K.Space }) };
	const context: InputActions.ContextSchema = { Actions: actions };
	// @ts-expect-error a misspelt option beside a context spread from a typed one
	InputActions.Create({ Contexts: { G: { ...context, Snk: true } } });
	// @ts-expect-error a misspelt option in one context of two
	InputActions.Create({ Contexts: { G: { Priorty: 5, Actions: actions }, H: { Actions: actions } } });
}

// ---- Set's parts on every action type and device

const PARTS = InputActions.Schema({
	Hd4Parts: {
		Actions: {
			Jump: InputActions.Bool({ Gamepad: K.ButtonR2 }),
			Throttle: InputActions.Direction1D({ Gamepad: K.ButtonR2 }),
			Look: InputActions.Direction2D({ Gamepad: K.Thumbstick1 }),
			Fly: InputActions.Direction3D({ KeyboardAndMouse: { Up: K.E } }),
			Point: InputActions.ViewportPosition({ KeyboardAndMouse: K.MousePosition }),
		},
	},
});

export function HunterDevices4SetRules() {
	const { Jump, Throttle, Look, Fly, Point } = InputActions.Create(PARTS).Hd4Parts.Actions;
	// what must compile: a part on every device's binding, keyless forms included
	Point.Bindings.KeyboardAndMouse.Set({ DisplayName: "Aim" });
	Fly.Bindings.Touch.Set({ Scale: 2 });
	Fly.Bindings.Gamepad.Set({ Vector3Scale: new Vector3(1, 1, 1) });
	Look.Bindings.Touch.Set({ Vector2Scale: new Vector2(1, 1) });
	Throttle.Bindings.Touch.Set({ Scale: 2 });
	Jump.Bindings.Touch.Set({ PressedThreshold: 0.2 });
	Look.Bindings.Gamepad.Set({});
	const part: InputActions.BindingPart<BoolType, "Gamepad"> = { PressedThreshold: 0.4 };
	Jump.Bindings.Gamepad.Set(part);
	const anyDevice: InputActions.BindingHandle<Dir2DType, InputActions.Device> =
		Look.Bindings.KeyboardAndMouse;
	anyDevice.Set({ ResponseCurve: 2 }); // any device's: checked at runtime
	// what must not compile
	// @ts-expect-error a KeyCode and a composite direction in one part
	Look.Bindings.Gamepad.Set({ KeyCode: K.Thumbstick2, Up: K.DPadUp });
	// @ts-expect-error the same on Direction1D
	Throttle.Bindings.Gamepad.Set({ KeyCode: K.ButtonR2, Up: K.ButtonY });
	// @ts-expect-error a KeyCode on Direction3D
	Fly.Bindings.KeyboardAndMouse.Set({ KeyCode: K.W });
	// @ts-expect-error another device's modifier in a part
	Jump.Bindings.KeyboardAndMouse.Set({ PrimaryModifier: K.ButtonA });
	// @ts-expect-error a ResponseCurve beside a mouse delta
	Look.Bindings.KeyboardAndMouse.Set({ ResponseCurve: 2, KeyCode: K.MouseDelta });
	// @ts-expect-error a ResponseCurve beside a composite direction on the gamepad
	Look.Bindings.Gamepad.Set({ ResponseCurve: 2, Up: K.DPadUp });
	// @ts-expect-error a modifier on a ViewportPosition binding
	Point.Bindings.KeyboardAndMouse.Set({ PrimaryModifier: K.LeftShift });
}

// ---- Set given back what Get returned

// HD4-6 (hunter, fixed: BindingData<A, D> and BindingPart<A, D> are the same forms, each object form with every property optional and only the forms whose KeyCode the device has; where the device has a key for none, a ViewportPosition binding on the gamepad, the form as it is, which holds only the display): Set(binding.Get()), a binding given back the data Get returned (a settings menu's Cancel restoring the snapshot it took), compiles on every device binding of every action type (round 3's BindingPart) but a Direction2D one on the keyboard and mouse or touch: BindingData<A, D> keeps each object form partial, the stick's form too, whose KeyCode the device lacks but whose ResponseCurve stays a number, and BindingPart<A, D> drops that form, so TS2345 "Argument of type 'Partial<IDirection2DDeltaBinding<IKeyboardAndMouseKeys>> | Partial<IDirection2DCompositeBinding<IKeyboardAndMouseKeys>> | Partial<...>' is not assignable to parameter of type ..." (tsc 5.5.3). The runtime takes it (hunter-devices-4: "Set given back what Get returned"). Likewise a gamepad ViewportPosition binding's part is never, so Set({ DisplayName }) is refused there, where API.md ("Binding shapes") says "Every binding may set DisplayName and DisplayImage". API.md (Types): "BindingShape<A, D>, BindingPart<A, D>, BindingData<A, D> | what Set takes (a shape, or part of an object shape without its key) and Get returns"
export function HunterDevices4RoundTripRules() {
	const { Jump, Throttle, Look, Fly, Point } = InputActions.Create(PARTS).Hd4Parts.Actions;
	Look.Bindings.KeyboardAndMouse.Set(Look.Bindings.KeyboardAndMouse.Get());
	Look.Bindings.Touch.Set(Look.Bindings.Touch.Get());
	Point.Bindings.Gamepad.Set({ DisplayName: "Aim" });
	// worker, HD4-6: the gamepad ViewportPosition binding round-trips too, and Get reads as before
	Point.Bindings.Gamepad.Set(Point.Bindings.Gamepad.Get());
	const aim: string | undefined = Point.Bindings.Gamepad.Get().DisplayName;
	const noKey: undefined = Point.Bindings.Gamepad.Get().KeyCode;
	const lookScale: Vector2 | undefined = Look.Bindings.Touch.Get().Vector2Scale;
	const lookKey: Enum.KeyCode | undefined = Look.Bindings.KeyboardAndMouse.Get().KeyCode;
	print(aim, noKey, lookScale, lookKey);
	// a snapshot kept in a variable typed as the exported data type, given back
	const snapshot: InputActions.BindingData<Dir2DType, "KeyboardAndMouse"> = Look.Bindings.KeyboardAndMouse.Get();
	Look.Bindings.KeyboardAndMouse.Set(snapshot);
	// what is still refused
	// @ts-expect-error no key on a gamepad ViewportPosition binding
	Point.Bindings.Gamepad.Set({ KeyCode: K.MousePosition });
	// @ts-expect-error no ResponseCurve on the keyboard and mouse's Direction2D binding, in a part or in Get's data
	Look.Bindings.KeyboardAndMouse.Set({ ResponseCurve: 2 });
	// @ts-expect-error nor a modifier on the gamepad ViewportPosition binding
	Point.Bindings.Gamepad.Set({ PrimaryModifier: K.ButtonA });
	// what compiles: every other device binding of every action type
	Jump.Bindings.KeyboardAndMouse.Set(Jump.Bindings.KeyboardAndMouse.Get());
	Jump.Bindings.Gamepad.Set(Jump.Bindings.Gamepad.Get());
	Jump.Bindings.Touch.Set(Jump.Bindings.Touch.Get());
	Throttle.Bindings.KeyboardAndMouse.Set(Throttle.Bindings.KeyboardAndMouse.Get());
	Throttle.Bindings.Gamepad.Set(Throttle.Bindings.Gamepad.Get());
	Throttle.Bindings.Touch.Set(Throttle.Bindings.Touch.Get());
	Look.Bindings.Gamepad.Set(Look.Bindings.Gamepad.Get());
	Fly.Bindings.KeyboardAndMouse.Set(Fly.Bindings.KeyboardAndMouse.Get());
	Fly.Bindings.Gamepad.Set(Fly.Bindings.Gamepad.Get());
	Fly.Bindings.Touch.Set(Fly.Bindings.Touch.Get());
	Point.Bindings.KeyboardAndMouse.Set(Point.Bindings.KeyboardAndMouse.Get());
	Point.Bindings.Touch.Set(Point.Bindings.Touch.Get());
}
