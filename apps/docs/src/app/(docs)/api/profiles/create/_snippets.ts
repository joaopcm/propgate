export const PROFILE_CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
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

export const PROFILE_CREATE_RESPONSE = `{
  "data": {
    "id": "019fcf6b-1a2b-7c3d-8e4f-5a6b7c8d9e0f",
    "key": "sending",
    "object": "profile",
    "requirements": [
      {
        "key": "ns",
        "check": "delegation"
      },
      {
        "key": "spf",
        "check": "spf",
        "include": "_spf.google.com"
      },
      {
        "key": "dkim",
        "check": "dkim",
        "selector": "google"
      },
      {
        "key": "dmarc",
        "check": "dmarc"
      },
      {
        "key": "mail",
        "check": "mx",
        "expectsMail": true
      }
    ],
    "version": 1
  },
  "error": null,
  "meta": null
}`;

export const PROFILE_REJECTED_CURL = `curl -s -X POST https://api.propgate.dev/v1/profiles \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{
    "key": "sending",
    "requirements": [
      { "key": "dkim", "check": "dkim" }
    ]
  }'`;

export const PROFILE_REJECTED_RESPONSE = `{
  "data": null,
  "error": {
    "message": "requirement \\"dkim\\" checks dkim and must name a selector"
  },
  "meta": null
}`;

export const PROFILE_CREATE_SDK = `const { data, error } = await propgate.profiles.create({
  key: "sending",
  requirements: [
    { key: "ns", check: "delegation" },
    { key: "spf", check: "spf", include: "_spf.google.com" },
    { key: "dkim", check: "dkim", selector: "google" },
    { key: "dmarc", check: "dmarc" },
    { key: "mail", check: "mx", expectsMail: true },
  ],
});`;

export const PROFILE_REJECTED_SDK = `const { error } = await propgate.profiles.create({
  key: "sending",
  requirements: [{ key: "dkim", check: "dkim" }],
});

error?.code;`;
