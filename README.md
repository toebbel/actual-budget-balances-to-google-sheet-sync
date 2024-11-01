# Actual Budget To Google Sheets Link

Syncs my actual budlget to Google Sheets.
Does also a bunch of statistics that might not be helpful for other folks.
Please feel free to pick any code you find useful.

`yarn run quick-sync` will sync the budget without running a bank sync.


For full control: `npx ts-node index.ts <flags>`
```
FLAGS:
  --no-bank-sync               - Don't Sync with the bank (defaults to false)
  --no-calc-category-stats     - Don't Calculate category stats (defaults to false)
  --no-ear-marked-transactions - Don't Generate earmarked transactions (defaults to false)
  --no-account-balances        - Don't Update account balances (defaults to false)
  --help, -h                   - show help
```