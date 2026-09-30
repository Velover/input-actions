import { OnStart, Provider } from "@flamework-experimental/core";
import { defineTests, expectTrue, test } from "@flamework-experimental/testing";
import { InputActions } from "@rbxts/input-actions";

// Validator round 4: schema checks both realms run (design spec sections 3, 4 and 8).

type AnyContexts = Record<string, InputActions.ContextSchema>;

/** Whether Schema refuses `contexts`, and what it said */
function refuses(contexts: AnyContexts): [boolean, string] {
	const [ok, message] = pcall(() => InputActions.Schema(contexts));
	return [!ok, tostring(message)];
}

@Provider({ activeIn: ["testing"] })
export class ValidatorR4SharedTests implements OnStart {
	onStart() {
		defineTests("validator-r4-shared", () => {
			test("Schema refuses a misspelt ServerAuthority, which would make the context local", () => {
				// what a typo in a hand-written schema looks like; it compiles (see
				// tests/type-rules/validator-r4-type-rules-failing.ts)
				const contexts = {
					R4Typo: {
						ServerAuthorty: true,
						Actions: { Jump: InputActions.Bool({ KeyboardAndMouse: Enum.KeyCode.Space }) },
					},
				} as unknown as AnyContexts;
				const [refused, message] = refuses(contexts);
				expectTrue(refused, "Schema accepted the context option ServerAuthorty");
				expectTrue(message.find("ServerAuthorty", 1, true)[0] !== undefined, message);
			});

			test("Schema refuses a misspelt Priority, Sink or Enabled", () => {
				for (const option of ["Prority", "Snk", "Enable"]) {
					const context: Record<string, unknown> = { Actions: {} };
					context[option] = true;
					const [refused] = refuses({ R4Typo: context } as unknown as AnyContexts);
					expectTrue(refused, `Schema accepted the context option ${option}`);
				}
			});
		});
	}
}
