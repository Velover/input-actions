import { GlobalEvents, GlobalFunctions } from "shared/network";

// Create each handler once, here. The first createClient call wins, and later calls ignore their
// config.
export const Events = GlobalEvents.createClient({});

export const Functions = GlobalFunctions.createClient({});
