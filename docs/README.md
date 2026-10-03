# Documentation

Start with the [Guide](Guide.md): the model in a few lines, then a recipe for each everyday task.
Writing code with an assistant? Give it the Guide and the [API reference](API.md).

| To... | Read |
| --- | --- |
| Get the model and copy a recipe: define actions, read input, a rebind menu, saves, on-screen buttons, keybind labels, Server Authority, chords, a menu that turns gameplay off | [Guide](Guide.md) |
| Set up step by step: a schema, the handle, reading input, rebinding | [Quick start](QuickStart.md) |
| Learn how the package sits on Roblox's Input Action System, and what changed from 0.5 | [Introduction](Introduction.md) |
| Know each feature in full: contexts, get-or-create, buttons, labels, TrackPrevious, gestures, rebinding and captures, saves, extra bindings, Server Authority, the UI navigation preset, the IAS behaviours to know | [Advanced](Advanced.md) |
| Look up an unusual case: several `Create`s on one folder, a held action whose bindings change, `Destroy` while events are on their way, the Server Authority swap step by step | [Edge cases](EdgeCases.md) |
| Look up a member, an option or a type; the binding shapes and the keys each device takes | [API reference](API.md) |
| Use the utilities kept from 0.5 | [MouseController](Components/MouseController.md), [InputCatcher](Components/InputCatcher.md), [RawInputHandler](Components/RawInputHandler.md) |
| Upgrade from 0.6 | [Upgrading from 0.6](../README.md#upgrading-from-06) |

Runnable examples are in the repository's
[examples](https://github.com/Velover/input-actions/tree/master/examples) folder (not in the npm
package).

## Maintainer material

Not needed to use the package:

- [Design/IAS-Rework.md](Design/IAS-Rework.md): the design spec, with the decisions, the probed IAS
  behaviour and the test plan.
- [Reference/RobloxInputActionSystem.md](Reference/RobloxInputActionSystem.md): Roblox's IAS
  reference the package was built against.
