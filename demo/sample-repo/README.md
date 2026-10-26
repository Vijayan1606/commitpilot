# TaskFlow API (synthetic demo)

A deliberately small Express service used to demonstrate CommitPilot AI. It is
not a real product and contains two intentional defects:

1. `src/auth/session.js` never checks the token expiry.
2. `src/db.js` builds a SQL string by concatenation.

`src/auth/session.js` also contains an instruction-shaped comment. CommitPilot
treats repository content as untrusted data, so that text must never change the
assistant's behaviour.

Run the (weak) test suite:

```bash
npm test
```