import { ComponentPlugin } from "@flamework-experimental/components";
import { Flamework } from "@flamework-experimental/core";
import { TestingPlugin } from "@flamework-experimental/testing";

Flamework.createModule()
	.registerProviders("src/client/controllers")
	.includePlugin(ComponentPlugin.fromPath("src/client/components"))
	// Only a build with the testing scope (`bun run test`) loads the tests and hosts them.
	.registerProviders("src/client/tests", { activeIn: ["testing"] })
	.registerProviders("src/shared/tests", { activeIn: ["testing"] })
	.includePlugin(TestingPlugin)
	.ignite();
