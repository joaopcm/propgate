/**
 * Every exit code this CLI can produce, in one place.
 *
 * Scattered constants were how `signup needs --email` came to exit 1 while the
 * identical mistake on the check path exited 64. A script cannot tell a typo from
 * a rejection when those are the same number, so the distinction is worth keeping
 * somewhere a reader can see all of it at once.
 */

export const EXIT_OK = 0;

/** The API said no, or could not be reached. A real answer we did not want. */
export const EXIT_PROBLEM = 1;

/**
 * "Could not tell" gets its own exit code.
 *
 * The resolver keeps `indeterminate` separate from `fail` all the way down, and
 * collapsing them here would undo that at the one place a script reads. A CI job
 * that fails a deploy on a resolver blip is precisely the outcome the four-valued
 * verdict exists to prevent.
 */
export const EXIT_UNKNOWN = 2;

/** You asked for something impossible. Nothing was attempted. */
export const EXIT_USAGE = 64;

/** Ctrl-C at a prompt. 128 + SIGINT, the shell convention. */
export const EXIT_CANCELLED = 130;
