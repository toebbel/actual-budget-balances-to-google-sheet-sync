require('dotenv').config()
import { google, sheets_v4} from 'googleapis';
import { differenceInMonths } from "date-fns";

import * as api from '@actual-app/api';
import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';


import { command, flag, run, boolean, string } from 'cmd-ts';
import { group } from 'console';

 class TransactionRow {
  account_closed: Boolean
  account_off_budget: Boolean
  account_name: string
  category_active: Boolean
  transaction_date: Date
  payee: string | null
  category_group: string | null
  category: string | null
  amount: number
  notes: string | null
  transfer_id: number | null

  constructor(account_closed: Boolean, account_off_budget: Boolean, account_name: string, category_active: Boolean, transaction_date: Date, payee: string | null, category_group: string | null, category: string | null, amount: number, notes: string | null, transfer_id: number | null) {
    this.account_closed = account_closed;
    this.account_off_budget = account_off_budget;
    this.account_name = account_name;
    this.category_active = category_active;
    this.transaction_date = transaction_date;
    this.payee = payee;
    this.category_group = category_group;
    this.category = category;
    this.amount = amount;
    this.notes = notes;
    this.transfer_id = transfer_id;
  }
}
class Category {
  name: string
  group: string
  active: Boolean
  constructor(name: string, group: string, active: Boolean) {
    this.name = name;
    this.group = group;
    this.active = active;
  }
}
class AccountInfo {
  name: string
  balance: number
  active: Boolean
  constructor(name: string, balance: number, active: Boolean) {
    this.name = name;
    this.balance = balance;
    this.active = active;
  }
}

class CategoryStats {
  name: string
  group: string
  average: number
  weighted_average: number
  budgeted: number
  constructor(name: string, group: string, average: number, weighted_average: number, budgeted: number) {
    this.name = name;
    this.group = group;
    this.average = average;
    this.weighted_average = weighted_average;
    this.budgeted = budgeted;
  }
}

async function authorize() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function updateValues(auth: GoogleAuth, spreadsheetId: String | undefined, spreadsheetRange: String | undefined, values: Array<any>) {
  const sheets = google.sheets({version: 'v4', auth});
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId,
    range: spreadsheetRange,
    includeValuesInResponse: false,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      range: spreadsheetRange,
      majorDimension: "ROWS",
      values: values
    }
  } as sheets_v4.Params$Resource$Spreadsheets$Values$Update);
  res.status === 200 ? console.log("✅ uploaded values") : console.error("❌ Failed to update values");
}

async function getTransactions(categoryLookup: {[key: string]: Category}, payeeLookup: {[key: string]: string}): Promise<Array<TransactionRow>> {
  let accounts = await api.getAccounts();
  const allTransactionsP = accounts.map(async (account: any) => {
    const transactions = await api.getTransactions(account.id, null, null);
    return transactions.flatMap((t: any) => {
      if (t.subtransactions.length > 0) {
        return t.subtransactions.map((st: any) => {
          return new TransactionRow(
            account.closed,
            account.offbudget,
            account.name,
            categoryLookup[t.category as string]?.active,
            new Date(t.date),
            payeeLookup[t.payee],
            categoryLookup[st.category as string]?.group,
            categoryLookup[st.category as string]?.name,
            api.utils.amountToInteger(st.amount) / 10000,
            st.notes + t.notes,
            t.transfer_id
          );
        });
      } else {
        return [new TransactionRow(
          account.closed,
          account.offbudget,
          account.name,
          categoryLookup[t.category as string]?.active,
          new Date(t.date),
          payeeLookup[t.payee],
          categoryLookup[t.category as string]?.group,
          categoryLookup[t.category as string]?.name,
          api.utils.amountToInteger(t.amount) / 10000,
          t.notes,
          t.transfer_id)]
      }
    });
  })
  const allTransactions = await Promise.all(allTransactionsP)
  return allTransactions.flat().sort((a, b) => {
    return b.transaction_date - a.transaction_date;
  })
  
}

async function loadCategories(): Promise<{[key: string]: Category}> {
  const categoryGroups = (await api.getCategoryGroups()).reduce((a: {[key: string]: string}, cg: any) => { return {...a, [cg.id]: cg.name} }, {} as {[key: string]: string});
  return (await api.getCategories()).reduce((a: {[key: string]: Category}, c: any) => {
    return {
      ...a,
      [c.id]: new Category(c.name, categoryGroups[c.group_id as string] || "", !c.hidden)
    }}, {} as {[key: string]: Category});
}

async function loadPayees(): Promise<{[key: string]: string}> {
  return (await api.getPayees()).reduce((acc: {[key: string]: string}, value: any) => { return { ...acc, [value.id]: value.name}}, {} as {[key: string]: string});
}

async function getAccountNamesAndBalances(): Promise<Array<AccountInfo>> {
  let accounts = await api.getAccounts();
	const accountNamesAndBalances = (await Promise.all(accounts.filter((a) => !a.closed).map(async (account) => {
    const transactions = await api.getTransactions(account.id, null, null)
    const balance = transactions.map((t: any) => t.amount).reduce((a: number, b: number) => a + b, 0)
    return new AccountInfo(account.name, api.utils.amountToInteger(balance) / 10000, !account.closed)
	}))).sort((a: AccountInfo, b: AccountInfo) => {
    const nameA = a.name.replace("[", "")
    const nameB = b.name.replace("[", "")
    if (nameA < nameB)
      return -1;
    if (nameA > nameB)
      return 1;
    return 0;
  });
  return accountNamesAndBalances
}

function categoryAges(ts: Array<TransactionRow>): {[key: string]: Date} {
  const categoryAges = {} as {[key: string]: Date};
  ts.forEach((t) => {
    if (categoryAges[t.category as string] === undefined || categoryAges[t.category as string] > t.transaction_date) {
      categoryAges[t.category as string] = t.transaction_date;
    }
  });
  return categoryAges;
}

function saveTransactionsToFile(ts: Array<TransactionRow>) {
  const columns = ["account closed", "account off-budget", "account name", "category active", "transaction date", "payee", "category group", "category", "amount", "notes", "transfer id"];
  function arrayToCSV(data: Array<TransactionRow>) {
    const escape = (v: any) => `"${("" + v).replace(/"/g, '""')}"`;
    return data.map(row => [row.account_closed, row.account_off_budget, row.account_name, row.category_active, row.transaction_date, row.payee, row.category_group, row.category, row.amount, row.notes, row.transfer_id].map(escape).join(','));
  }
  fs.writeFileSync('./transactions.csv', [columns, ...arrayToCSV(ts)].join('\n'));
}

function calculateCategoryStats(categories: {[key: string]: Category}, ts: Array<TransactionRow>) {
  const oldest_transaction_ever = ts.map((t) => t.transaction_date).reduce((a, b) => a < b ? a : b, new Date());
  const num_weights = differenceInMonths(new Date(), oldest_transaction_ever) + 1;
  const weights = Array<number>(num_weights).fill(1);
  for (let i = 12; i < num_weights; i++) {
    weights[i] = 1 / (1 + (i - 12));
  }
  
  // Calculate Stats Per Category
  const categoryStats = {} as {[key: string]: CategoryStats};
  Object.values(categories).filter(c => c.active).forEach((c: Category) => {
    const transactions = ts.filter((t) => t.category === c.name);
    const oldest_transaction = transactions.map((t) => t.transaction_date).reduce((a, b) => a < b ? a : b, new Date());
    const number_months = differenceInMonths(new Date(), oldest_transaction) + 1;
    const months = Array<number>(number_months).fill(0);
    transactions.forEach((t) => {
      const idx = differenceInMonths(new Date(), t.transaction_date);
      months[idx] = (months[idx] || 0) + t.amount;
    })
    const weighted_average = months.map((m, i) => m * weights[i]).reduce((a, b) => a + b, 0) / weights.slice(0, months.length).reduce((a, b) => a + b, 0);
    const average = months.reduce((a, b) => a + b, 0) / months.length;
    // when c.name contains a string like '300/m' then it means we spend 300 per month. Use a regex to extract the number
    const monthly_budget = c.name.match(/(\d+(\.\d+)?)\/m/);
    const quaterly_budget = c.name.match(/(\d+(\.\d+)?)\/qt/);
    const yearly_budget = c.name.match(/(\d+(\.\d+)?)\/y/);
    const budgeted = (Number(monthly_budget ? monthly_budget[1] : 0) + Number(quaterly_budget ? quaterly_budget[1] : 0) / 3 + Number(yearly_budget ? yearly_budget[1] : 0) / 12);

    categoryStats[c.name] = new CategoryStats(c.name, c.group, average, weighted_average, budgeted);
  });
  return categoryStats
}

function normalizeTransactionByCadence(transaction: TransactionRow): TransactionRow {
  const regex = /\#assume(d)?\-((cadence)|(interval))\:(?<amountStr>\d+)(?<unitStr>[my])/g;
  if (transaction.notes && transaction.notes.match(regex) === null || transaction.notes === null) {
    return transaction;
  }
  const match = regex.exec(transaction.notes || "");
  const { amountStr, unitStr } = match?.groups || {};
  let normalizationMonths = parseInt(amountStr || "0");
  if (unitStr == "y") {
    normalizationMonths = normalizationMonths * 12;
  }

  const transactionAge = Math.max(1, differenceInMonths(new Date(), transaction.transaction_date));
  if (transactionAge >= normalizationMonths) {
    return transaction;
  }
  const normalizedAmount = transaction.amount / normalizationMonths * transactionAge;
  console.log(`♻️ Normalized transaction ${transaction.payee?.trim()} (${transaction.notes.trim()}) from ${transaction.amount} SEK to ${Math.round(normalizedAmount)} SEK`);
  return new TransactionRow(
    transaction.account_closed,
    transaction.account_off_budget,
    transaction.account_name,
    transaction.category_active,
    transaction.transaction_date,
    transaction.payee,
    transaction.category_group,
    transaction.category,
    transaction.amount,
    `normalized to ${normalizedAmount}` + transaction.notes,
    transaction.transfer_id
  );
}

function generateEarmarkedTransactions(ts: Array<TransactionRow>) {
    const earmarkReceivingAccounts = ["[Santander] Sparkonto Tobi", "[Santander] Sparkonto+", "[Danske] Future Us", "[REV][EUR] Tobi Sparen", "[Resurs] Sparkonto", "🏡 Hjälmvik"]
    // Extract all Transactions that are ear marked
    const earmarkedTransactions = ts.filter((t) => 
        earmarkReceivingAccounts.includes(t.account_name) &&
        typeof t.notes === 'string' &&
        t.notes?.includes("ear:")
      ).map((t) => {
        return [t.account_name, t.transaction_date, t.payee, t.amount, t.notes?.replace("#ear:","")];
    }).filter((t) => t !== null);
    const columns = ["account name", "transaction date", "payee", "amount", "ear mark"];
    return [columns, ...earmarkedTransactions];
}

// (async () => {
//   await api.init({
//     serverURL: process.env.ACTUAL_SERVER_URL,
//     password: process.env.ACTUAL_SERVER_PASSWORD,
//   });
//   await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, {password:process.env.ACTUAL_BUDGET_PASSWORD});
  
//   const categories = await loadCategories();
//   const ts = await getTransactions(categories, await loadPayees())
  
//   const categoryStats = calculateCategoryStats(categories, ts);
//   const categoryNames = Object.keys(categoryStats).sort()
//   const categoryStatsCsv = categoryNames.map((name: string) => categoryStats[name]).map((c: CategoryStats) => [c.name, c.group, c.average, c.weighted_average, c.budgeted]);

//   const accountBalances = await getAccountNamesAndBalances()
//   const accountBalancesCsv = accountBalances.map((a: AccountInfo) => [a.name, a.balance]);
//   const googleAuth = await authorize();
//   await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_ACCOUNT_BALANCES_RANGE, accountBalancesCsv);
//   await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_STATS_RANGE, categoryStatsCsv);
//   await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_EARMARKED_TRANSACTIONS_RANGE, generateEarmarkedTransactions(ts));
//   //saveTransactionsToFile(ts);
  
// })().then(() => { console.log("Done"); process.exit(); }).catch(console.error);

// Define the flags
const bankSyncFlag = flag({
  type: boolean,
  long: 'no-bank-sync',
  defaultValue: () => false,
  description: 'Don\'t Sync with the bank (defaults to false)',
});

const calcCategoryStatsFlag = flag({
  type: boolean,
  long: 'no-calc-category-stats',
  defaultValue: () => false,
  description: 'Don\'t Calculate category stats (defaults to false)',
});

const earMarkedTransactionsFlag = flag({
  type: boolean,
  long: 'no-ear-marked-transactions',
  defaultValue: () => false,
  description: 'Don\'t Generate earmarked transactions (defaults to false)',
});

const accountBalancesFlag = flag({
  type: boolean,
  long: 'no-account-balances',
  defaultValue: () => false,
  description: 'Don\'t Update account balances (defaults to false)',
});

// Define the command
const mainCommand = command({
  name: 'main',
  args: {
    noBankSync: bankSyncFlag,
    noCalcCategoryStats: calcCategoryStatsFlag,
    noEarMarkedTransactions: earMarkedTransactionsFlag,
    noAccountBalances: accountBalancesFlag,
  },
  handler: async ({ noBankSync, noCalcCategoryStats, noEarMarkedTransactions, noAccountBalances }) => {
    await api.init({
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_SERVER_PASSWORD,
    });
    console.log("👇 Downloading budget");
    await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, { password: process.env.ACTUAL_BUDGET_PASSWORD });

    if (!noBankSync) {
      console.log(`🏦 Syncing accounts from bank`);
      await Promise.all((await api.getAccounts()).filter((a: any) => !a.closed).map(async (account: any) => {
        await api.runBankSync(account.id).catch().finally(() => console.log(`✅ Synced account ${account.name}`));
      }));
    }

    if (!noAccountBalances) {
      console.log("🏦 Updating account balances");
      const accountBalances = await getAccountNamesAndBalances();
      const accountBalancesCsv = accountBalances.map((a: AccountInfo) => [a.name, a.balance]);
      const googleAuth = await authorize();
      await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_ACCOUNT_BALANCES_RANGE, accountBalancesCsv);
    }

    if (!noCalcCategoryStats || !noEarMarkedTransactions) {
      console.log("🏦 loading categories")
      const categories = await loadCategories();
      console.log("🏦 loading transactions")
      const ts = (await getTransactions(categories, await loadPayees())).map((t) => normalizeTransactionByCadence(t));;

      if (!noCalcCategoryStats) {
        console.log("🏦 Calculating category stats");
        const categoryStats = calculateCategoryStats(categories, ts);
        const categoryNames = Object.keys(categoryStats).sort();
        const categoryStatsCsv = categoryNames.map((name: string) => categoryStats[name]).map((c: CategoryStats) => [c.name, c.group, c.average, c.weighted_average, c.budgeted]);
        const googleAuth = await authorize();
        await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_STATS_RANGE, categoryStatsCsv);
      }

      if (!noEarMarkedTransactions) {
        console.log("🏦 Generating earmarked transactions");
        const googleAuth = await authorize();
        await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_EARMARKED_TRANSACTIONS_RANGE, generateEarmarkedTransactions(ts));
      }
    }

    console.log("🎉 Done");
    process.exit();
  },
});

// Run the command
run(mainCommand, process.argv.slice(2)).catch(console.error);