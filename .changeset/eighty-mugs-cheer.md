---
"@propgate/dns": patch
---

`ServerAddress`, `Finding`, `Lookup` and the check pipeline's types are exported
from the package entry point, so a consumer can type a response without
reaching into `dist`.
