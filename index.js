require('dotenv').config()

const process = require('process');
// Google API
const {google} = require('googleapis');

// Actual API
const api = require('@actual-app/api');
const fs = require('fs')

const { stringify } = require('csv-stringify');


async function authorize() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function updateValues(auth, spreadsheetId, spreadsheetRange, values) {
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
  });
  console.log('response from Google Sheets', res)
}

async function getTransactions(categoryLookup, payeeLookup) {
  let accounts = await api.getAccounts();
  const allTransactionsP = accounts.map(async (account) => {
    const transactions = await api.getTransactions(account.id);
    return transactions.flatMap((t) => {
      if (t.subtransactions.length > 0) {
        return t.subtransactions.map((st) => {
          return [
            account.closed,
            account.offbudget,
            account.name,
            categoryLookup[t.category]?.active,
            t.date,
            payeeLookup[t.payee],
            categoryLookup[st.category]?.group,
            categoryLookup[st.category]?.name,
            api.utils.amountToInteger(st.amount) / 10000,
            st.notes + t.notes,
            t.transfer_id];
        });
      } else {
        return [[
          account.closed,
          account.offbudget,
          account.name,
          categoryLookup[t.category]?.active,
          t.date,
          payeeLookup[t.payee],
          categoryLookup[t.category]?.group,
          categoryLookup[t.category]?.name,
          api.utils.amountToInteger(t.amount) / 10000,
          t.notes,
          t.transfer_id]];
      }
    });
  })
  const allTransactions = await Promise.all(allTransactionsP)
  return allTransactions.flat().sort((a, b) => {
    return new Date(b[3]) - new Date(a[3]);
  })
  
}


async function loadCategories(categoryId) {
  const categoryGroups = (await api.getCategoryGroups()).reduce((a, cg) => { return {...a, [cg.id]: cg.name} }, {})
  return (await api.getCategories()).reduce((a, c) => {
    return {
      ...a,
      [c.id]: { name: c.name, group: categoryGroups[c.group_id] || "", active: !c.hidden}
    }}, {})
}

async function loadPayees() {
  return (await api.getPayees()).reduce((acc, value) => { return { ...acc, [value.id]: value.name}}, {})
}

async function getAccountNamesAndBalances() {
  let accounts = await api.getAccounts();
	const accountNamesAndBalances = (await Promise.all(accounts.filter((a) => !a.closed).map(async (account) => {
    const transactions = await api.getTransactions(account.id)
    const balance = transactions.map((t) => t.amount).reduce((a, b) => a + b, 0)
    return [account.name, api.utils.amountToInteger(balance) / 10000]
	}))).sort((a, b) => {
    const nameA = a[0].replace("[", "")
    const nameB = b[0].replace("[", "")
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

  const googleAuth = await authorize();
  const ts = await getTransactions(await loadCategories(), await loadPayees())
  
  columns = ["account closed", "account off-budget", "account name", "category active", "transaction date", "payee", "category group", "category", "amount", "notes", "transfer id"];
  function arrayToCSV(data) {
    return data.map(row => row.map(String).map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
  }
  const data = [columns, ...ts];
  fs.writeFileSync('./transactions.csv', arrayToCSV(data));
  
  //await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_RANGE, await getAccountNamesAndBalances());
  //await updateValues(googleAuth, process.env.SPREADSHEET_ID, process.env.SPREADSHEET_TRANSACTIONS_RANGE, ts);
  
})().then(() => { console.log("Done"); process.exit(); }).catch(console.error);
