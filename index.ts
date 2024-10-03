require('dotenv').config()
import { google, sheets_v4} from 'googleapis';
import { differenceInMonths } from "date-fns";

import * as api from '@actual-app/api';
import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';

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
  constructor(name: string, group: string, average: number, weighted_average: number) {
    this.name = name;
    this.group = group;
    this.average = average;
    this.weighted_average = weighted_average;
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
  console.log('response from Google Sheets', res)
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

(async () => {
  await api.init({
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
  });
  await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, {password:process.env.ACTUAL_BUDGET_PASSWORD});

  
  //await api.shutdown(); // fails for some reason

  
  const categories = await loadCategories();
  const ts = await getTransactions(categories, await loadPayees())
  
  const columns = ["account closed", "account off-budget", "account name", "category active", "transaction date", "payee", "category group", "category", "amount", "notes", "transfer id"];
  function arrayToCSV(data: Array<TransactionRow>) {
    const escape = (v: any) => `"${("" + v).replace(/"/g, '""')}"`;
    return data.map(row => [row.account_closed, row.account_off_budget, row.account_name, row.category_active, row.transaction_date, row.payee, row.category_group, row.category, row.amount, row.notes, row.transfer_id].map(escape).join(','));
  }
  fs.writeFileSync('./transactions.csv', [columns, ...arrayToCSV(ts)].join('\n'));
  const oldest_transaction_ever = ts.map((t) => t.transaction_date).reduce((a, b) => a < b ? a : b, new Date());
  const num_weights = differenceInMonths(new Date(), oldest_transaction_ever) + 1;
  const weights = Array<number>(num_weights).fill(1);
  for (let i = 12; i < num_weights; i++) {
    weights[i] = 1 / (1 + (i - 12));
  }
  
  const categoryStats = {} as {[key: string]: CategoryStats};
  Object.values(categories).filter(c => c.active).forEach((c: Category) => {
    console.log(`calculating stats for ${c.name}`)
    const transactions = ts.filter((t) => t.category === c.name);
    const oldest_transaction = transactions.map((t) => t.transaction_date).reduce((a, b) => a < b ? a : b, new Date());
    const number_months = differenceInMonths(new Date(), oldest_transaction) + 1;
    const months = Array<number>(number_months)
    transactions.forEach((t) => {
      const idx = differenceInMonths(t.transaction_date, oldest_transaction);
      months[idx] = (months[idx] || 0) + t.amount;
    })
    const weighted_average = months.map((m, i) => m * weights[i]).reduce((a, b) => a + b, 0) / weights.slice(0, months.length).reduce((a, b) => a + b, 0);
    const average = months.reduce((a, b) => a + b, 0) / months.length;
    categoryStats[c.name] = new CategoryStats(c.name, c.group, average, weighted_average);
  });
  
  const categoryNames = Object.keys(categoryStats).sort()
  const categoryStatsCsv = categoryNames.map((name: string) => categoryStats[name]).map((c: CategoryStats) => [c.name, c.group, c.average, c.weighted_average]);

  const accountBalances = await getAccountNamesAndBalances()
  const accountBalancesCsv = accountBalances.map((a: AccountInfo) => [a.name, a.balance]);
  const googleAuth = await authorize();
  await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_ACCOUNT_BALANCES_RANGE, accountBalancesCsv);
  await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_STATS_RANGE, categoryStatsCsv);
  
})().then(() => { console.log("Done"); process.exit(); }).catch(console.error);
