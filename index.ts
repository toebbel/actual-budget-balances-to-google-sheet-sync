require('dotenv').config();
import { google, sheets_v4 } from 'googleapis';
import { differenceInMonths } from 'date-fns';
import * as api from '@actual-app/api';
import fs from 'fs';
import { GoogleAuth } from 'google-auth-library';
import { command, flag, run } from 'cmd-ts';

// Class Definitions
class TransactionRow {
  constructor(
    public account_closed: Boolean,
    public account_off_budget: Boolean,
    public account_name: string,
    public category_active: Boolean,
    public transaction_date: Date,
    public payee: string | null,
    public category_group: string | null,
    public category: string | null,
    public amount: number,
    public notes: string | null,
    public transfer_id: number | null
  ) {}
}

class Category {
  constructor(public name: string, public group: string, public active: Boolean) {}
}

class AccountInfo {
  constructor(public name: string, public balance: number, public active: Boolean) {}
}

class CategoryStats {
  constructor(
    public name: string,
    public group: string,
    public average: number,
    public weighted_average: number,
    public budgeted: number
  ) {}
}

// Environment Variable Validation
function validateEnvVars() {
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
  if (missingVars.length) {
    console.error(`Error: Missing environment variables - ${missingVars.join(', ')}`);
    process.exit(1);
  }
}
const requiredEnvVars = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ACTUAL_SERVER_URL',
  'ACTUAL_SERVER_PASSWORD',
  'SPREADSHEET_ID',
  'ACCOUNTS_BALANCES_RANGE',
  'PRIOR_MONTH_RANGE',
  'CURRENT_MONTH_RANGE',
  'ACTUAL_BUDGET_ID',
];
validateEnvVars();

// Reusable Google Authorization
async function authorize(): Promise<GoogleAuth> {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// Update Values in Google Sheets
async function updateSheetValues(
  auth: GoogleAuth,
  spreadsheetId: string,
  range: string,
  values: Array<any>,
  description: string
) {
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const res = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    } as sheets_v4.Params$Resource$Spreadsheets$Values$Update);
    res.status === 200
      ? console.log(`✅ Successfully updated ${description} at range: ${range}`)
      : console.error(`❌ Failed to update ${description}`);
  } catch (error) {
    console.error(`Error updating ${description} in range ${range}: ${error.message}`);
  }
}

// Fetch Transactions
async function getTransactions(
  categoryLookup: { [key: string]: Category },
  payeeLookup: { [key: string]: string }
): Promise<Array<TransactionRow>> {
  const accounts = await api.getAccounts();
  const allTransactions = await Promise.all(
    accounts.map(async (account: any) => {
      const transactions = await api.getTransactions(account.id, null, null);
      return transactions.flatMap((t: any) => {
        if (t.subtransactions.length > 0) {
          return t.subtransactions.map((st: any) => new TransactionRow(
            account.closed,
            account.offbudget,
            account.name,
            categoryLookup[t.category as string]?.active,
            new Date(t.date),
            payeeLookup[t.payee],
            categoryLookup[st.category as string]?.group,
            categoryLookup[st.category as string]?.name,
            api.utils.amountToInteger(st.amount) / 10000,
            `${st.notes} ${t.notes}`,
            t.transfer_id
          ));
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
            t.transfer_id
          )];
        }
      });
    })
  );
  return allTransactions.flat().sort((a, b) => b.transaction_date.getTime() - a.transaction_date.getTime());
}

// Load Categories and Payees
async function loadCategories(): Promise<{ [key: string]: Category }> {
  const categoryGroups = (await api.getCategoryGroups()).reduce(
    (a: { [key: string]: string }, cg: any) => ({ ...a, [cg.id]: cg.name }),
    {}
  );
  return (await api.getCategories()).reduce((a: { [key: string]: Category }, c: any) => {
    return {
      ...a,
      [c.id]: new Category(c.name, categoryGroups[c.group_id as string] || '', !c.hidden),
    };
  }, {});
}

async function loadPayees(): Promise<{ [key: string]: string }> {
  return (await api.getPayees()).reduce(
    (acc: { [key: string]: string }, value: any) => ({ ...acc, [value.id]: value.name }),
    {}
  );
}

// Get Account Balances
async function getAccountNamesAndBalances(): Promise<Array<AccountInfo>> {
  const accounts = await api.getAccounts();
  const accountNamesAndBalances = await Promise.all(
    accounts.filter((a) => !a.closed).map(async (account) => {
      const transactions = await api.getTransactions(account.id, null, null);
      const balance = transactions.reduce((acc: number, t: any) => acc + t.amount, 0);
      return new AccountInfo(account.name, api.utils.amountToInteger(balance) / 10000, !account.closed);
    })
  );
  return accountNamesAndBalances.sort((a, b) => a.name.localeCompare(b.name));
}

// Calculate Category Stats
function calculateCategoryStats(categories: { [key: string]: Category }, ts: Array<TransactionRow>) {
  const oldestTransaction = ts.reduce((a, t) => (t.transaction_date < a ? t.transaction_date : a), new Date());
  const numWeights = differenceInMonths(new Date(), oldestTransaction) + 1;
  const weights = Array.from({ length: numWeights }, (_, i) => (i < 12 ? 1 : 1 / (1 + (i - 12))));

  const categoryStats = {} as { [key: string]: CategoryStats };
  for (const c of Object.values(categories).filter((c) => c.active)) {
    const transactions = ts.filter((t) => t.category === c.name);
    const oldestTransaction = transactions.reduce((a, t) => (t.transaction_date < a ? t.transaction_date : a), new Date());
    const months = Array(differenceInMonths(new Date(), oldestTransaction) + 1).fill(0);
    transactions.forEach((t) => {
      const idx = differenceInMonths(t.transaction_date, oldestTransaction);
      months[idx] += t.amount;
    });
    const weightedAverage = months.reduce((acc, month, i) => acc + month * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
    const average = months.reduce((a, b) => a + b, 0) / months.length;

    const budgeted = parseBudgetedValue(c.name);

    categoryStats[c.name] = new CategoryStats(c.name, c.group, average, weightedAverage, budgeted);
  }
  return categoryStats;
}

// Helper Function to Parse Budget
function parseBudgetedValue(name: string) {
  const monthly = name.match(/(\d+(\.\d+)?)\/m/);
  const quarterly = name.match(/(\d+(\.\d+)?)\/qt/);
  const yearly = name.match(/(\d+(\.\d+)?)\/y/);
  return (
    (Number(monthly ? monthly[1] : 0) +
      Number(quarterly ? quarterly[1] : 0) / 3 +
      Number(yearly ? yearly[1] : 0) / 12)
  );
}

// Define Flags for Selective Execution
const bankSyncFlag = flag({ type: boolean, long: 'no-bank-sync', defaultValue: () => false });
const calcCategoryStatsFlag = flag({ type: boolean, long: 'no-calc-category-stats', defaultValue: () => false });
const earMarkedTransactionsFlag = flag({ type: boolean, long: 'no-ear-marked-transactions', defaultValue: () => false });
const accountBalancesFlag = flag({ type: boolean, long: 'no-account-balances', defaultValue: () => false });

// Main Command
const mainCommand = command({
  name: 'main',
  args: { noBankSync: bankSyncFlag, noCalcCategoryStats: calcCategoryStatsFlag, noEarMarkedTransactions: earMarkedTransactionsFlag, noAccountBalances: accountBalancesFlag },
  handler: async ({ noBankSync, noCalcCategoryStats, noEarMarkedTransactions, noAccountBalances }) => {
    const auth = await authorize();
    await api.init({ serverURL: process.env.ACTUAL_SERVER_URL, password: process.env.ACTUAL_SERVER_PASSWORD });
    console.log("Downloading budget data...");
    await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, { password: process.env.ACTUAL_BUDGET_PASSWORD });

    if (!noBankSync) {
      console.log("Syncing accounts from bank...");
      await Promise.all(
        (await api.getAccounts())
          .filter((a: any) => !a.closed)
          .map(async (account: any) => {
            await api.runBankSync(account.id).catch(console.error);
          })
      );
    }

    if (!noAccountBalances) {
      console.log("Updating account balances...");
      const accountBalances = await getAccountNamesAndBalances();
      await updateSheetValues(auth, process.env.SPREADSHEET_ID, process.env.ACCOUNTS_BALANCES_RANGE, accountBalances.map((a) => [a.name, a.balance]), "Account Balances");
    }

    if (!noCalcCategoryStats || !noEarMarkedTransactions) {
      const categories = await loadCategories();
      const transactions = await getTransactions(categories, await loadPayees());

      if (!noCalcCategoryStats) {
        const categoryStats = calculateCategoryStats(categories, transactions);
        await updateSheetValues(auth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_STATS_RANGE, Object.values(categoryStats).map((c) => [c.name, c.group, c.average, c.weighted_average, c.budgeted]), "Category Stats");
      }

      if (!noEarMarkedTransactions) {
        const earmarkedTransactions = generateEarmarkedTransactions(transactions);
        await updateSheetValues(auth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_EARMARKED_TRANSACTIONS_RANGE, earmarkedTransactions, "Earmarked Transactions");
      }
    }

    const currentDate = new Date();
    const priorMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().slice(0, 7);
    const currentMonth = currentDate.toISOString().slice(0, 7);
    const priorMonthData = await getMonthData(priorMonth);
    const currentMonthData = await getMonthData(currentMonth);

    await updateSheetValues(auth, process.env.SPREADSHEET_ID, process.env.PRIOR_MONTH_RANGE, priorMonthData, "Prior Month Data");
    await updateSheetValues(auth, process.env.SPREADSHEET_ID, process.env.CURRENT_MONTH_RANGE, currentMonthData, "Current Month Data");

    console.log("Data synchronization completed.");
    process.exit();
  },
});

// Run the Command
run(mainCommand, process.argv.slice(2)).catch(console.error);
