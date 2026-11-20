# UAT

Repeatable acceptance tests for TelemuneSmartAi. The plan, all test cases and the latest results are in
[docs/TelemuneSmartAi-UAT.md](../docs/TelemuneSmartAi-UAT.md).

```bash
node uat/run-uat.mjs            # run all free tests (creates and deletes its own tester accounts)
node uat/run-uat.mjs --keep     # keep the testers for the screen checks; remove later with --cleanup <run>
```

Reports go to `uat/reports/` (not committed).
