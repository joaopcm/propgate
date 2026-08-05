/**
 * Code fed to `CodeTabs` on the introduction page.
 *
 * `github.com` throughout, not a placeholder domain: the two findings quoted
 * below it are real, from README's "See it" section, and switching the
 * domain would make the curl and CLI examples stop matching the prose.
 */

export const CHECK_CURL = `curl -s -X POST https://api.propgate.dev/v1/checks \\
  -H 'content-type: application/json' -d '{"domain":"github.com"}'`;

export const CHECK_CLI = "npx @propgate/cli check github.com";
