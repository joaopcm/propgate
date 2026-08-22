export const PROFILE_GET_CURL = `curl -s https://api.propgate.dev/v1/profiles/sending \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const PROFILE_GET_RESPONSE = `{
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
    "version": 2
  },
  "error": null,
  "meta": null
}`;

export const PROFILE_GET_NOT_FOUND = `{
  "data": null,
  "error": {
    "message": "no profile named \\"sending\\""
  },
  "meta": null
}`;

export const PROFILE_GET_SDK = `const { data, error } = await propgate.profiles.get("sending");`;
