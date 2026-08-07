/**
 * The `--require` micro-syntax and the two ways past it.
 *
 * Field names here are the API's own body field names, unaliased, which is the
 * point of the syntax: a `422` from the server names the same word that was
 * typed. See `packages/cli/src/require.ts`.
 */

export const CREATE_CLI = `propgate profiles create --key sending \\
  --require 'ns:delegation' \\
  --require 'spf:spf:include=_spf.google.com' \\
  --require 'dkim:dkim:selector=google' \\
  --require 'dmarc:dmarc' \\
  --require 'mail:mx:expectsMail=true'`;

export const CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "ns", "check": "delegation" },
      { "key": "spf", "check": "spf", "include": "_spf.google.com" },
      { "key": "dkim", "check": "dkim", "selector": "google" },
      { "key": "dmarc", "check": "dmarc" },
      { "key": "mail", "check": "mx", "expectsMail": true }
    ]
  }'`;

export const CREATE_OUTPUT = `Created sending.

sending  version 1

  ns     delegation
  spf    spf         include=_spf.google.com
  dkim   dkim        selector=google
  dmarc  dmarc
  mail   mx          expectsMail=true`;

export const FILE_CLI = `propgate profiles create --file profile.json

# or from a generator, over stdin
your-generator | propgate profiles create --file -`;

export const GUIDED = `$ propgate profiles create

│  What should this profile be called?
│  sending
│
│  Name this requirement
│  dkim
│
│  What should "dkim" check?
│  ○ delegation  ○ spf  ● dkim  ○ dmarc  ○ mx  ○ caa
│
│  Which DKIM selector?
│  google
│
│  The public key you issued (enter to skip)
│
│  Add another requirement?
│  ● No / ○ Yes`;

export const REJECTED = `$ propgate profiles create --key sending --require 'k1:dkim'
propgate: k1: dkim needs a selector, as k1:dkim:selector=<name>`;

export const GET_CLI = "propgate profiles get sending";
