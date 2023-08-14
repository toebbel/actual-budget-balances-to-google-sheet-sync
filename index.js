require('dotenv').config()

// Google API
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// Actual API
const api = require('@actual-app/api');


async function authorize() {
  return new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function updateValues(auth, accountNamesAndBalances) {
  const sheets = google.sheets({version: 'v4', auth});
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: process.env.SPREADSHEET_RANGE,
    includeValuesInResponse: true,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      range: process.env.SPREADSHEET_RANGE,
      majorDimension: "ROWS",
      values: accountNamesAndBalances
    }
  });
  console.log('response from Google Sheets', res)
}



(async () => {
  await api.init({
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
  });
  await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, {password:process.env.ACTUAL_BUDGET_PASSWORD});

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
  //await api.shutdown(); // fails for some reason

  const googleAuth = await authorize();
  await updateValues(googleAuth, accountNamesAndBalances);
})().then(() => { console.log("Done"); process.exit(); }).catch(console.error);
