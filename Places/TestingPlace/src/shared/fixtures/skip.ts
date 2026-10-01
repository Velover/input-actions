/**
 * Logs why the running test can't run here; the test returns right after, and counts as passed.
 * The line lands in Studio's output just before the runner's `[FWTEST] ... PASS` line for the test.
 */
export function skip(reason: string) {
	warn(`[SKIP] ${reason}`);
}
