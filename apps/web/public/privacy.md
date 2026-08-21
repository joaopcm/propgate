# Privacy — propgate

This page is about what propgate actually collects. It is not a substitute for reading the code; both the public checker and the API are in the repository at https://github.com/joaopcm/propgate.

The website at propgate.dev is a static front end. The domain you type into the checker is sent to POST https://api.propgate.dev/v1/checks so the check can run. That endpoint is request-driven and stateless: nothing about the domain, the findings, or your address is stored. There is no account cookie, no analytics pixel, and no third-party marketing script on this site.

If you create an account, we store the email address you proved control of, a hash of each API key, the domains you register, the profiles you define, webhook URLs, hashed webhook secrets, and the results of checks you ask us to remember. We store those because that is the product — a domain nobody can look up again is not being monitored. We do not sell this data. We do not use it to advertise. Keys are shown once; only their hashes remain.

OTP codes used at signup are stored hashed, expire in ten minutes, and are limited in attempts. Mail is sent so you can confirm the address. If you self-host the API, this data lives on your box, not ours.

To ask a question about data we hold on an account, open an issue at https://github.com/joaopcm/propgate/issues. To stop us tracking a domain, delete it through the API or CLI. Revoking a key takes effect on the next request.
