/**
 * The level a player with `coins` coins has reached. Level 1 starts at 0, and each level costs 10
 * coins more than the one before: level 2 at 10 coins, level 3 at 30, level 4 at 60.
 */
export function getLevel(coins: number) {
	// Written this way, NaN also gets level 1.
	if (!(coins >= 10)) return 1;

	// Level L starts at 5 * L * (L - 1) coins, solved here for L. Unlike a loop that pays each
	// level's cost, it ends for any input, math.huge included. The square root can round up just
	// below a threshold, so step back when the level found starts above `coins`.
	const level = math.floor((1 + math.sqrt(1 + (4 * coins) / 5)) / 2);
	return 5 * level * (level - 1) > coins ? level - 1 : level;
}
